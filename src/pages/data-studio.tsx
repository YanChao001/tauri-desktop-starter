import { OrderForm } from "@/features/data-studio/order-form";
import { RecordsTable } from "@/features/data-studio/records-table";
import { useI18n } from "@/providers/i18n";

export default function DataStudio() {
  const { t } = useI18n();
  return (
    <div className="studio-page space-y-5">
      <div className="studio-intro">
        <span className="studio-eyebrow">{t("labs.eyebrow")}</span>
        <h2>{t("labs.data.title")}</h2>
        <p>{t("labs.data.description")}</p>
      </div>
      <RecordsTable />
      <OrderForm />
    </div>
  );
}
