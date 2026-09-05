import { Link } from "react-router-dom";
import { Sprout } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Public privacy policy. Linked from the Google OAuth consent screen and
 * required for the Play Store listing.
 */
export default function Privacy() {
  const { t } = useTranslation("common");
  const sections = t("privacy.sections", { returnObjects: true }) as {
    title: string;
    body: string;
  }[];

  return (
    <div className="min-h-screen bg-surface px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 mb-8">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center">
            <Sprout size={18} className="text-on-primary" />
          </div>
          <span className="font-semibold text-on-surface">Chia</span>
        </Link>

        <h1 className="text-2xl font-bold text-on-surface mb-2">{t("privacy.title")}</h1>
        <p className="text-sm text-on-surface-variant mb-8">{t("privacy.updated")}</p>

        <div className="space-y-6">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-base font-semibold text-on-surface mb-1">{s.title}</h2>
              <p className="text-sm text-on-surface-variant leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
