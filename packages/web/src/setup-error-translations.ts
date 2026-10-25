import type { Language } from "@nodepass/contracts";

const rows: Record<Language, string[]> = {
  de_DE: [
    "Einrichtung fehlgeschlagen",
    "Phase",
    "Fehlerreferenz {reference}. Details: npm run preview:logs (Produktion: docker compose logs app).",
  ],
  en_US: [
    "Setup failed",
    "Phase",
    "Error reference {reference}. Details: npm run preview:logs (production: docker compose logs app).",
  ],
  es_ES: [
    "Error de configuración",
    "Fase",
    "Referencia del error {reference}. Detalles: npm run preview:logs (producción: docker compose logs app).",
  ],
  ca_ES: [
    "Error de configuració",
    "Fase",
    "Referència de l’error {reference}. Detalls: npm run preview:logs (producció: docker compose logs app).",
  ],
  hu_HU: [
    "A beállítás sikertelen",
    "Fázis",
    "Hibahivatkozás: {reference}. Részletek: npm run preview:logs (éles rendszer: docker compose logs app).",
  ],
  fr_FR: [
    "Échec de la configuration",
    "Étape",
    "Référence de l’erreur {reference}. Détails : npm run preview:logs (production : docker compose logs app).",
  ],
  pl_PL: [
    "Konfiguracja nie powiodła się",
    "Etap",
    "Identyfikator błędu {reference}. Szczegóły: npm run preview:logs (produkcja: docker compose logs app).",
  ],
  ru_RU: [
    "Ошибка настройки",
    "Этап",
    "Код ошибки {reference}. Подробности: npm run preview:logs (рабочая среда: docker compose logs app).",
  ],
  nl_NL: [
    "Instellen mislukt",
    "Fase",
    "Foutreferentie {reference}. Details: npm run preview:logs (productie: docker compose logs app).",
  ],
  pt_BR: [
    "Falha na configuração",
    "Etapa",
    "Referência do erro {reference}. Detalhes: npm run preview:logs (produção: docker compose logs app).",
  ],
  it_IT: [
    "Configurazione non riuscita",
    "Fase",
    "Riferimento errore {reference}. Dettagli: npm run preview:logs (produzione: docker compose logs app).",
  ],
  da: [
    "Opsætningen mislykkedes",
    "Trin",
    "Fejlreference {reference}. Detaljer: npm run preview:logs (produktion: docker compose logs app).",
  ],
  fo: [
    "Uppsetingin miseydnaðist",
    "Stig",
    "Feilávísing {reference}. Nærri upplýsingar: npm run preview:logs (framleiðsla: docker compose logs app).",
  ],
  ja_JP: [
    "設定に失敗しました",
    "処理段階",
    "エラー参照番号 {reference}。詳細: npm run preview:logs（本番環境: docker compose logs app）。",
  ],
};

export const setupErrorMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, values]) => [
    locale,
    {
      setupFailureTitle: values[0]!,
      setupFailurePhase: values[1]!,
      setupFailureReference: values[2]!,
    },
  ]),
);
