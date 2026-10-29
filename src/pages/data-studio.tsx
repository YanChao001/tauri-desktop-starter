import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderForm } from "@/features/data-studio/order-form";
import { RecordsTable } from "@/features/data-studio/records-table";
import { useI18n } from "@/providers/i18n";
import "@/styles/experience.css";

export default function DataStudio() {
  const { t } = useI18n();
  const [view, setView] = useState("records");
  return (
    <div className="studio-page">
      <div className="studio-intro">
        <h2>{t("labs.data.title")}</h2>
        <p>{t("labs.data.description")}</p>
      </div>
      <Tabs value={view} onValueChange={setView} className="demo-page-tabs">
        <TabsList aria-label={t("experience.data.tabs")}>
          <TabsTrigger value="records">
            {t("experience.data.records")}
          </TabsTrigger>
          <TabsTrigger value="form">{t("experience.data.form")}</TabsTrigger>
        </TabsList>
        <TabsContent
          value="records"
          forceMount
          hidden={view !== "records"}
          className="demo-tab-panel"
        >
          <RecordsTable />
        </TabsContent>
        <TabsContent
          value="form"
          forceMount
          hidden={view !== "form"}
          className="demo-tab-panel"
        >
          <OrderForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
