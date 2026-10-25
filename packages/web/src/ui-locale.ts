import {
  deDE,
  enUS,
  esES,
  caES,
  huHU,
  frFR,
  plPL,
  ruRU,
  nlNL,
  ptBR,
  itIT,
  daDK,
  jaJP,
  type NLocale,
  dateDeDE,
  dateEnUS,
  dateEsES,
  dateCaES,
  dateHuHU,
  dateFrFR,
  datePlPL,
  dateRuRU,
  dateNlNL,
  datePtBR,
  dateItIT,
  dateDaDK,
  dateJaJP,
  type NDateLocale,
} from "naive-ui";
import type { Locale } from "date-fns";
const fo: Locale = {
  ...dateDaDK.locale,
  code: "fo",
  localize: {
    ...dateDaDK.locale.localize,
    month: (month, options) =>
      new Intl.DateTimeFormat("fo", {
        timeZone: "UTC",
        month:
          options?.width === "wide"
            ? "long"
            : options?.width === "narrow"
              ? "narrow"
              : "short",
      }).format(new Date(Date.UTC(2024, month, 1))),
    day: (day, options) =>
      new Intl.DateTimeFormat("fo", {
        timeZone: "UTC",
        weekday:
          options?.width === "wide"
            ? "long"
            : options?.width === "narrow"
              ? "narrow"
              : "short",
      }).format(new Date(Date.UTC(2024, 0, 7 + day))),
  },
};
import type { Language } from "@nodepass/contracts";
export const uiLocales: Record<Language, NLocale> = {
  de_DE: deDE,
  en_US: enUS,
  es_ES: esES,
  ca_ES: caES,
  hu_HU: huHU,
  fr_FR: frFR,
  pl_PL: plPL,
  ru_RU: ruRU,
  nl_NL: nlNL,
  pt_BR: ptBR,
  it_IT: itIT,
  da: daDK,
  ja_JP: jaJP,
  fo: {
    ...enUS,
    name: "fo",
    global: {
      undo: "Angra",
      redo: "Ger umaftur",
      confirm: "Vátta",
      clear: "Rudda",
    },
    Popconfirm: { positiveText: "Vátta", negativeText: "Angra" },
    Input: { placeholder: "Skriva her" },
    InputNumber: { placeholder: "Skriva tal" },
    Select: { placeholder: "Vel" },
    Empty: { description: "Eingin færsla enn" },
    DataTable: {
      checkTableAll: "Vel øll í talvuni",
      uncheckTableAll: "Frável øll í talvuni",
      confirm: "Vátta",
      clear: "Rudda",
    },
    Pagination: { goto: "Far til", selectionSuffix: "síða" },
    DynamicTags: { add: "Legg afturat" },
    DynamicInput: { create: "Ger" },
    Log: { loading: "Lesur …" },
    DatePicker: {
      ...enUS.DatePicker,
      clear: "Rudda",
      now: "Nú",
      today: "Í dag",
      confirm: "Vátta",
      selectTime: "Vel klokkuslett",
      selectDate: "Vel dagfesting",
      datePlaceholder: "Vel dagfesting",
      datetimePlaceholder: "Vel dagfesting og klokkuslett",
      monthPlaceholder: "Vel mánað",
      yearPlaceholder: "Vel ár",
      quarterPlaceholder: "Vel ársfjórðing",
      weekPlaceholder: "Vel viku",
      startDatePlaceholder: "Byrjanardagur",
      endDatePlaceholder: "Endadagur",
      startDatetimePlaceholder: "Byrjanardagur og klokkuslett",
      endDatetimePlaceholder: "Endadagur og klokkuslett",
      startMonthPlaceholder: "Byrjanarmánaður",
      endMonthPlaceholder: "Endamánaður",
      monthBeforeYear: false,
      firstDayOfWeek: 0,
    },
  },
};
export const dateLocales: Record<Language, NDateLocale> = {
  de_DE: dateDeDE,
  en_US: dateEnUS,
  es_ES: dateEsES,
  ca_ES: dateCaES,
  hu_HU: dateHuHU,
  fr_FR: dateFrFR,
  pl_PL: datePlPL,
  ru_RU: dateRuRU,
  nl_NL: dateNlNL,
  pt_BR: datePtBR,
  it_IT: dateItIT,
  da: dateDaDK,
  ja_JP: dateJaJP,
  fo: { name: "fo", locale: fo },
};
