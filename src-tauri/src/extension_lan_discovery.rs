//! 有界局域网公告；不扫描地址、不建立 TCP 连接，也不持久保存附近设备。
use super::*;

const DISCOVERY_PORT: u16 = 45874;
const PROTOCOL: &str = "tauri-starter-lan";
const MAX_PACKET: usize = 768;
const MAX_PEERS: usize = 64;
const ANNOUNCE_INTERVAL: Duration = Duration::from_secs(3);
const PEER_TTL: Duration = Duration::from_secs(12);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Announcement {
    protocol: String,
    version: u8,
    extension_id: String,
    node_id: String,
    nickname: String,
    port: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiscoveredPeer {
    id: String,
    nickname: String,
    address: String,
    port: u16,
    last_seen: u64,
}

fn decode(
    bytes: &[u8],
    source: SocketAddr,
    extension_id: &str,
    own_id: &str,
    received_at: u64,
) -> Option<DiscoveredPeer> {
    if bytes.len() > MAX_PACKET || !source.is_ipv4() || !local_ip(source.ip()) {
        return None;
    }
    let packet: Announcement = serde_json::from_slice(bytes).ok()?;
    if packet.protocol != PROTOCOL
        || packet.version != 2
        || packet.extension_id != extension_id
        || !valid_token(&packet.node_id)
        || packet.node_id == own_id
        || packet.port == 0
    {
        return None;
    }
    Some(DiscoveredPeer {
        id: packet.node_id,
        nickname: nickname(&packet.nickname).ok()?,
        // 远端只声明身份和 TCP 端口；目标 IP 来自实际 UDP 源，拒绝公告注入地址。
        address: source.ip().to_string(),
        port: packet.port,
        last_seen: received_at,
    })
}

#[derive(Default)]
struct State {
    peers: BTreeMap<String, (DiscoveredPeer, Instant)>,
    error: Option<String>,
}
impl State {
    fn prune(&mut self, tick: Instant) {
        self.peers
            .retain(|_, (_, seen)| tick.saturating_duration_since(*seen) < PEER_TTL);
    }
    fn observe(&mut self, peer: DiscoveredPeer, tick: Instant) {
        self.prune(tick);
        if !self.peers.contains_key(&peer.id) && self.peers.len() >= MAX_PEERS {
            let oldest = self
                .peers
                .iter()
                .min_by_key(|(_, (_, seen))| *seen)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                self.peers.remove(&id);
            }
        }
        self.peers.insert(peer.id.clone(), (peer, tick));
    }
}

pub(super) struct Discovery {
    state: Arc<Mutex<State>>,
    worker: Option<JoinHandle<()>>,
}
impl Discovery {
    pub(super) fn start(
        node: Arc<Node>,
        address: Ipv4Addr,
        broadcast: Ipv4Addr,
        port: u16,
        stop: Arc<AtomicBool>,
    ) -> Result<Self, &'static str> {
        let receiver = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT)).map_err(|_| {
            "Automatic discovery is unavailable; its UDP port may be in use. Connect by IP instead"
        })?;
        let sender = UdpSocket::bind((address, 0))
            .map_err(|_| "Cannot open automatic discovery on this network interface")?;
        Self::with_sockets(
            node,
            port,
            stop,
            receiver,
            sender,
            SocketAddr::from((broadcast, DISCOVERY_PORT)),
        )
    }

    fn with_sockets(
        node: Arc<Node>,
        port: u16,
        stop: Arc<AtomicBool>,
        receiver: UdpSocket,
        sender: UdpSocket,
        destination: SocketAddr,
    ) -> Result<Self, &'static str> {
        receiver
            .set_nonblocking(true)
            .and_then(|()| sender.set_nonblocking(true))
            .and_then(|()| sender.set_ttl(1))
            .and_then(|()| sender.set_broadcast(true))
            .map_err(|_| "Cannot configure automatic discovery; connect by IP instead")?;
        let state = Arc::new(Mutex::new(State::default()));
        let worker_state = state.clone();
        let node = Arc::downgrade(&node);
        let worker = thread::Builder::new()
            .name("extension-lan-discovery".into())
            .spawn(move || {
                let mut last_announcement: Option<Instant> = None;
                let mut bytes = [0_u8; MAX_PACKET + 1];
                while !stop.load(Ordering::Acquire) {
                    let Some(node) = node.upgrade() else {
                        break;
                    };
                    let Ok(data) = node.data.lock() else {
                        break;
                    };
                    let extension_id = data.extension_id.clone();
                    let own_id = data.node_id.clone();
                    let name = data.nickname.clone();
                    drop(data);
                    let tick = Instant::now();
                    if last_announcement.is_none_or(|at| tick.duration_since(at) >= ANNOUNCE_INTERVAL)
                    {
                        let packet = Announcement {
                            protocol: PROTOCOL.into(),
                            version: 2,
                            extension_id: extension_id.clone(),
                            node_id: own_id.clone(),
                            nickname: name,
                            port,
                        };
                        let sent = serde_json::to_vec(&packet)
                            .ok()
                            .filter(|packet| packet.len() <= MAX_PACKET)
                            .is_some_and(|packet| sender.send_to(&packet, destination).is_ok());
                        if let Ok(mut state) = worker_state.lock() {
                            state.error = (!sent).then(|| {
                                "Automatic discovery could not announce this device. Connect by IP instead".into()
                            });
                        }
                        last_announcement = Some(tick);
                    }
                    // 限制每轮收包数量，即使收到持续异常广播也及时检查停止与公告期限。
                    for _ in 0..32 {
                        if stop.load(Ordering::Acquire) {
                            break;
                        }
                        match receiver.recv_from(&mut bytes) {
                            Ok((count, source)) => {
                                if let Some(peer) = decode(&bytes[..count], source, &extension_id, &own_id, now())
                                    && let Ok(mut state) = worker_state.lock()
                                {
                                    state.observe(peer, Instant::now());
                                }
                            }
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                            Err(_) => {
                                if let Ok(mut state) = worker_state.lock() {
                                    state.error = Some("Automatic discovery could not receive announcements. Connect by IP instead".into());
                                }
                                break;
                            }
                        }
                    }
                    thread::sleep(Duration::from_millis(40));
                }
            })
            .map_err(|_| "Cannot start automatic discovery; connect by IP instead")?;
        Ok(Self {
            state,
            worker: Some(worker),
        })
    }

    pub(super) fn snapshot(&self) -> NativeResult<(Vec<DiscoveredPeer>, Option<String>)> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| unavailable("Automatic discovery state is unavailable"))?;
        state.prune(Instant::now());
        Ok((
            state.peers.values().map(|(peer, _)| peer.clone()).collect(),
            state.error.clone(),
        ))
    }

    pub(super) fn join(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ActiveNode(Arc<Node>);
    impl Drop for ActiveNode {
        fn drop(&mut self) {
            self.0.stop();
        }
    }

    fn packet(id: &str, name: &str) -> Vec<u8> {
        serde_json::to_vec(&Announcement {
            protocol: PROTOCOL.into(),
            version: 2,
            extension_id: "market.lan-chat".into(),
            node_id: id.into(),
            nickname: name.into(),
            port: 45873,
        })
        .unwrap()
    }

    #[test]
    fn announcements_use_the_private_source_address_and_reject_untrusted_metadata() {
        let own = "00000000000000000000000000000000";
        let peer = "11111111111111111111111111111111";
        let source: SocketAddr = "192.168.1.9:55441".parse().unwrap();
        let bytes = packet(peer, "小周");
        let found = decode(&bytes, source, "market.lan-chat", own, 123).unwrap();
        assert_eq!(found.address, "192.168.1.9");
        assert_eq!(found.port, 45873);
        assert_eq!(found.last_seen, 123);
        assert!(decode(&bytes, source, "other.plugin", own, 123).is_none());
        assert!(decode(&bytes, source, "market.lan-chat", peer, 123).is_none());
        assert!(
            decode(
                &bytes,
                "8.8.8.8:9".parse().unwrap(),
                "market.lan-chat",
                own,
                123
            )
            .is_none()
        );
        for change in [
            json!({"version": 1}),
            json!({"port": 0}),
            json!({"nodeId": "invalid"}),
            json!({"nickname": "\n"}),
            json!({"address": "192.168.1.99"}),
            json!({"protocol": "another-protocol"}),
        ] {
            let mut value: Value = serde_json::from_slice(&bytes).unwrap();
            value
                .as_object_mut()
                .unwrap()
                .extend(change.as_object().unwrap().clone());
            assert!(
                decode(
                    &serde_json::to_vec(&value).unwrap(),
                    source,
                    "market.lan-chat",
                    own,
                    123
                )
                .is_none()
            );
        }
        assert!(
            decode(
                &vec![b' '; MAX_PACKET + 1],
                source,
                "market.lan-chat",
                own,
                123
            )
            .is_none()
        );
    }

    #[test]
    fn nearby_devices_expire_and_remain_bounded_without_becoming_contacts() {
        let mut state = State::default();
        let tick = Instant::now();
        for index in 0..MAX_PEERS + 3 {
            state.observe(
                DiscoveredPeer {
                    id: format!("{index:032x}"),
                    nickname: "附近设备".into(),
                    address: "192.168.1.9".into(),
                    port: 45873,
                    last_seen: index as u64,
                },
                tick,
            );
        }
        assert_eq!(state.peers.len(), MAX_PEERS);
        state.prune(tick + PEER_TTL + Duration::from_millis(1));
        assert!(state.peers.is_empty());
    }

    #[test]
    fn real_udp_discovery_reports_devices_and_stops_with_its_session() {
        let first_root = tempfile::tempdir().unwrap();
        let second_root = tempfile::tempdir().unwrap();
        let first = Node::open(first_root.path(), "market.lan-chat").unwrap();
        let second = Node::open(second_root.path(), "market.lan-chat").unwrap();
        first.start("甲", Ipv4Addr::LOCALHOST.into(), 0).unwrap();
        second.start("乙", Ipv4Addr::LOCALHOST.into(), 0).unwrap();
        let first = ActiveNode(first);
        let second = ActiveNode(second);
        let first_socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let second_socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let first_address = first_socket.local_addr().unwrap();
        let second_address = second_socket.local_addr().unwrap();
        let first_id = first.0.data.lock().unwrap().node_id.clone();
        let second_id = second.0.data.lock().unwrap().node_id.clone();
        for (node, receiver, target) in [
            (&first.0, first_socket, second_address),
            (&second.0, second_socket, first_address),
        ] {
            let mut runtime = node.runtime.lock().unwrap();
            runtime.discovery = Some(
                Discovery::with_sockets(
                    node.clone(),
                    runtime.port,
                    runtime.stop.clone(),
                    receiver,
                    UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap(),
                    target,
                )
                .unwrap(),
            );
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while first.0.status().unwrap()["discoveredPeers"]
            .as_array()
            .unwrap()
            .is_empty()
            || second.0.status().unwrap()["discoveredPeers"]
                .as_array()
                .unwrap()
                .is_empty()
        {
            assert!(
                Instant::now() < deadline,
                "UDP announcements were not exchanged"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            first.0.status().unwrap()["discoveredPeers"][0]["id"],
            second_id
        );
        assert_eq!(
            first.0.status().unwrap()["discoveredPeers"][0]["nickname"],
            "乙"
        );
        assert_eq!(
            second.0.status().unwrap()["discoveredPeers"][0]["id"],
            first_id
        );
        assert!(first.0.data.lock().unwrap().contacts.is_empty());
        assert!(second.0.data.lock().unwrap().contacts.is_empty());
        assert!(first.0.runtime.lock().unwrap().connections.is_empty());
        assert!(second.0.runtime.lock().unwrap().connections.is_empty());
        first.0.stop();
        second.0.stop();
        assert_eq!(first.0.status().unwrap()["discoveredPeers"], json!([]));
        assert!(first.0.runtime.lock().unwrap().discovery.is_none());
        assert!(UdpSocket::bind(first_address).is_ok());
        assert!(UdpSocket::bind(second_address).is_ok());
    }
}
