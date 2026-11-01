//! LAN 监听与发现共用一个私有 IPv4 接口快照，不让 VPN 的非私有默认路由遮蔽本机局域网。
use super::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct LanInterface {
    pub(super) address: Ipv4Addr,
    pub(super) broadcast: Option<Ipv4Addr>,
}
impl LanInterface {
    fn loopback() -> Self {
        Self {
            address: Ipv4Addr::LOCALHOST,
            broadcast: None,
        }
    }
}

#[derive(Clone)]
struct Candidate {
    name: String,
    address: Ipv4Addr,
    prefix_len: u8,
    up: bool,
    point_to_point: bool,
    index: u32,
}
fn private_interface(address: Ipv4Addr) -> bool {
    address.is_private() || address.is_link_local()
}
impl Candidate {
    fn usable(&self) -> bool {
        self.up && !self.point_to_point && private_interface(self.address)
    }
    fn broadcast(&self) -> Option<Ipv4Addr> {
        // Windows 的 netmask/broadcast 可能取自另一条前缀；使用该单播地址自己的前缀。
        if !(1..=30).contains(&self.prefix_len) {
            return None;
        }
        let mask = u32::MAX << (32 - self.prefix_len);
        Some(Ipv4Addr::from(u32::from(self.address) | !mask))
    }
    fn looks_virtual(&self) -> bool {
        let name = self.name.to_ascii_lowercase();
        // 接口名称可由用户修改，仅降低回退顺序，不把它当作权限或物理网卡证明。
        [
            "virtual",
            "vethernet",
            "vmware",
            "vbox",
            "hyper-v",
            "docker",
            "tailscale",
            "zerotier",
            "wireguard",
            "vpn",
        ]
        .iter()
        .any(|part| name.contains(part))
            || ["veth", "virbr", "tun", "tap", "utun", "ppp", "wg"]
                .iter()
                .any(|prefix| name.starts_with(prefix))
    }
    fn selected(&self) -> LanInterface {
        LanInterface {
            address: self.address,
            broadcast: self.broadcast(),
        }
    }
}

fn select(default_route: Option<Ipv4Addr>, candidates: &[Candidate]) -> LanInterface {
    let candidates = || candidates.iter().filter(|candidate| candidate.usable());
    if let Some(route) = default_route
        && let Some(candidate) = candidates().find(|candidate| candidate.address == route)
    {
        return candidate.selected();
    }
    candidates()
        .min_by_key(|candidate| {
            (
                candidate.looks_virtual(),
                candidate.broadcast().is_none(),
                candidate.address.is_link_local(),
                candidate.index,
                u32::from(candidate.address),
            )
        })
        .map_or_else(LanInterface::loopback, Candidate::selected)
}

pub(super) fn default_route_address() -> Option<Ipv4Addr> {
    // UDP connect 仅查询本机路由，不发送数据、解析 DNS 或探测外部服务。
    UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .ok()
        .and_then(|socket| {
            socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
            socket.local_addr().ok()
        })
        .and_then(|address| match address.ip() {
            IpAddr::V4(ip) => Some(ip),
            IpAddr::V6(_) => None,
        })
}

pub(super) fn default_interface() -> LanInterface {
    let route = default_route_address();
    let interfaces = match if_addrs::get_if_addrs() {
        Ok(interfaces) => interfaces,
        Err(_) => {
            return route
                .filter(|address| {
                    private_interface(*address) && UdpSocket::bind((*address, 0)).is_ok()
                })
                .map_or_else(LanInterface::loopback, |address| LanInterface {
                    address,
                    broadcast: None,
                });
        }
    };
    let candidates: Vec<_> = interfaces
        .iter()
        .filter_map(|interface| {
            let if_addrs::IfAddr::V4(address) = &interface.addr else {
                return None;
            };
            let candidate = Candidate {
                name: interface.name.clone(),
                address: address.ip,
                prefix_len: address.prefixlen,
                up: interface.is_oper_up(),
                point_to_point: interface.is_p2p(),
                index: interface.index.unwrap_or(u32::MAX),
            };
            // 枚举与绑定之间可能切换网络；只选择此刻仍可绑定的接口，不发送探测包。
            (candidate.usable() && UdpSocket::bind((candidate.address, 0)).is_ok())
                .then_some(candidate)
        })
        .collect();
    select(route, &candidates)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(name: &str, address: &str) -> Candidate {
        Candidate {
            name: name.into(),
            address: address.parse().unwrap(),
            prefix_len: 24,
            up: true,
            point_to_point: false,
            index: 1,
        }
    }

    #[test]
    fn vpn_default_route_falls_back_to_an_active_private_lan_interface() {
        let interfaces = [
            candidate("vEthernet (WSL)", "172.20.0.1"),
            candidate("WLAN", "192.168.3.8"),
            candidate("TomatoCloud", "198.19.0.1"),
        ];
        let selected = select(Some("198.19.0.1".parse().unwrap()), &interfaces);
        assert_eq!(selected.address, Ipv4Addr::new(192, 168, 3, 8));
        assert_eq!(selected.broadcast, Some(Ipv4Addr::new(192, 168, 3, 255)));
    }

    #[test]
    fn valid_private_default_route_has_priority_over_other_interfaces() {
        let interfaces = [
            candidate("Ethernet", "192.168.1.9"),
            candidate("WLAN", "10.2.3.4"),
        ];
        assert_eq!(
            select(Some("10.2.3.4".parse().unwrap()), &interfaces).address,
            Ipv4Addr::new(10, 2, 3, 4)
        );
    }

    #[test]
    fn down_point_to_point_and_non_private_interfaces_do_not_become_lan_listeners() {
        let mut down = candidate("Ethernet", "192.168.1.9");
        down.up = false;
        let mut tunnel = candidate("Tunnel", "10.2.3.4");
        tunnel.point_to_point = true;
        let interfaces = [
            down,
            tunnel,
            candidate("Loopback", "127.0.0.1"),
            candidate("VPN", "198.19.0.1"),
            candidate("Public", "8.8.8.8"),
        ];
        assert_eq!(
            select(Some("198.19.0.1".parse().unwrap()), &interfaces),
            LanInterface::loopback()
        );
        assert_eq!(select(None, &[]), LanInterface::loopback());
    }

    #[test]
    fn subnet_broadcast_uses_the_selected_interface_prefix() {
        let mut interface = candidate("WLAN", "192.168.2.8");
        interface.prefix_len = 23;
        assert_eq!(
            select(None, &[interface.clone()]).broadcast,
            Some(Ipv4Addr::new(192, 168, 3, 255))
        );
        interface.prefix_len = 32;
        assert_eq!(select(None, &[interface]).broadcast, None);
    }

    #[test]
    #[ignore = "Explicit local no-packet interface diagnostic; reports only booleans"]
    fn host_interface_selection_diagnostic() {
        let route = default_route_address();
        let selected = default_interface();
        let interfaces = if_addrs::get_if_addrs().unwrap();
        let private_available = interfaces.iter().any(|interface| {
            interface.is_oper_up()
                && !interface.is_p2p()
                && matches!(interface.ip(), IpAddr::V4(ip) if private_interface(ip) && UdpSocket::bind((ip, 0)).is_ok())
        });
        let source = UdpSocket::bind((selected.address, 0)).unwrap();
        let source_bound = source.local_addr().unwrap().ip() == IpAddr::V4(selected.address);
        let selected_private = private_interface(selected.address);
        assert!(!private_available || selected_private);
        assert!(source_bound);
        eprintln!(
            "LAN interface diagnostic: default_route_private={}, private_available={}, selected_private={}, selected_loopback={}, subnet_broadcast={}, source_bound={}",
            route.is_some_and(private_interface),
            private_available,
            selected_private,
            selected.address.is_loopback(),
            selected.broadcast.is_some(),
            source_bound,
        );
    }
}
