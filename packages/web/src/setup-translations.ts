import type { Language } from "@nodepass/contracts";

const keys = [
  "setupMaintenanceHelp",
  "setupRequiredField",
  "setupMaxLength",
  "setupMaxBytes",
  "setupLoginHint",
  "setupPasswordHint",
];
const rows: Record<Language, string> = {
  de_DE:
    "Bei der direkten Übernahme darf sysPass nicht gleichzeitig in dieselbe Datenbank schreiben. Sichere Datenbank und config.xml vorab separat. nodePass erstellt vor der Umstellung zusätzlich eine Sicherung.|Bitte ausfüllen.|Höchstens {max} Zeichen.|Höchstens {max} UTF-8-Bytes.|1–50 Zeichen: Buchstaben, Zahlen sowie _ . {'@'} -|Mindestens {minLength} Zeichen und Stärke {minScore}/4. Höchstens 128 Zeichen (512 UTF-8-Bytes).",
  en_US:
    "During a direct migration, sysPass must not write to the same database at the same time. Back up the database and config.xml separately beforehand. nodePass also creates a backup before the migration.|Please fill in this field.|At most {max} characters.|At most {max} UTF-8 bytes.|1–50 characters: letters, numbers and _ . {'@'} -|At least {minLength} characters and strength {minScore}/4. At most 128 characters (512 UTF-8 bytes).",
  es_ES:
    "Durante una migración directa, sysPass no debe escribir en la misma base de datos al mismo tiempo. Guarda antes una copia independiente de la base de datos y config.xml. nodePass también crea una copia antes de la migración.|Completa este campo.|Como máximo {max} caracteres.|Como máximo {max} bytes UTF-8.|Entre 1 y 50 caracteres: letras, números y _ . {'@'} -|Al menos {minLength} caracteres y seguridad {minScore}/4. Como máximo 128 caracteres (512 bytes UTF-8).",
  ca_ES:
    "Durant una migració directa, sysPass no ha d’escriure a la mateixa base de dades alhora. Desa abans una còpia independent de la base de dades i config.xml. nodePass també crea una còpia abans de la migració.|Omple aquest camp.|Com a màxim {max} caràcters.|Com a màxim {max} bytes UTF-8.|Entre 1 i 50 caràcters: lletres, números i _ . {'@'} -|Com a mínim {minLength} caràcters i seguretat {minScore}/4. Com a màxim 128 caràcters (512 bytes UTF-8).",
  hu_HU:
    "Közvetlen migráció során a sysPass nem írhat egyidejűleg ugyanabba az adatbázisba. Előzetesen készítsen külön mentést az adatbázisról és a config.xml fájlról. A nodePass is készít mentést a migráció előtt.|Töltse ki ezt a mezőt.|Legfeljebb {max} karakter.|Legfeljebb {max} UTF-8-bájt.|1–50 karakter: betűk, számok és _ . {'@'} -|Legalább {minLength} karakter és {minScore}/4 erősség. Legfeljebb 128 karakter (512 UTF-8-bájt).",
  fr_FR:
    "Lors d’une migration directe, sysPass ne doit pas écrire simultanément dans la même base de données. Sauvegardez au préalable la base de données et config.xml séparément. nodePass crée également une sauvegarde avant la migration.|Renseignez ce champ.|Au maximum {max} caractères.|Au maximum {max} octets UTF-8.|De 1 à 50 caractères : lettres, chiffres et _ . {'@'} -|Au moins {minLength} caractères et une robustesse de {minScore}/4. Au maximum 128 caractères (512 octets UTF-8).",
  pl_PL:
    "Podczas bezpośredniej migracji sysPass nie może jednocześnie zapisywać danych w tej samej bazie. Wcześniej wykonaj oddzielną kopię bazy danych i pliku config.xml. nodePass tworzy również kopię przed migracją.|Wypełnij to pole.|Maksymalnie {max} znaków.|Maksymalnie {max} bajtów UTF-8.|Od 1 do 50 znaków: litery, cyfry oraz _ . {'@'} -|Co najmniej {minLength} znaków i siła {minScore}/4. Maksymalnie 128 znaków (512 bajtów UTF-8).",
  ru_RU:
    "При прямом переносе sysPass не должен одновременно записывать данные в ту же базу. Заранее создайте отдельную резервную копию базы данных и config.xml. nodePass также создаёт копию перед переносом.|Заполните это поле.|Не более {max} символов.|Не более {max} байт UTF-8.|От 1 до 50 символов: буквы, цифры и _ . {'@'} -|Не менее {minLength} символов и стойкость {minScore}/4. Не более 128 символов (512 байт UTF-8).",
  nl_NL:
    "Bij een directe migratie mag sysPass niet tegelijkertijd naar dezelfde database schrijven. Maak vooraf een afzonderlijke back-up van de database en config.xml. nodePass maakt ook een back-up vóór de migratie.|Vul dit veld in.|Maximaal {max} tekens.|Maximaal {max} UTF-8-bytes.|1–50 tekens: letters, cijfers en _ . {'@'} -|Minimaal {minLength} tekens en sterkte {minScore}/4. Maximaal 128 tekens (512 UTF-8-bytes).",
  pt_BR:
    "Durante uma migração direta, o sysPass não pode gravar no mesmo banco de dados ao mesmo tempo. Faça antes uma cópia separada do banco de dados e do config.xml. O nodePass também cria um backup antes da migração.|Preencha este campo.|No máximo {max} caracteres.|No máximo {max} bytes UTF-8.|De 1 a 50 caracteres: letras, números e _ . {'@'} -|Pelo menos {minLength} caracteres e força {minScore}/4. No máximo 128 caracteres (512 bytes UTF-8).",
  it_IT:
    "Durante una migrazione diretta, sysPass non deve scrivere contemporaneamente nello stesso database. Salva prima una copia separata del database e di config.xml. Anche nodePass crea una copia prima della migrazione.|Compila questo campo.|Al massimo {max} caratteri.|Al massimo {max} byte UTF-8.|Da 1 a 50 caratteri: lettere, numeri e _ . {'@'} -|Almeno {minLength} caratteri e robustezza {minScore}/4. Al massimo 128 caratteri (512 byte UTF-8).",
  da: "Ved en direkte migrering må sysPass ikke samtidig skrive til den samme database. Tag først en separat sikkerhedskopi af databasen og config.xml. nodePass opretter også en sikkerhedskopi før migreringen.|Udfyld dette felt.|Højst {max} tegn.|Højst {max} UTF-8-bytes.|1–50 tegn: bogstaver, tal og _ . {'@'} -|Mindst {minLength} tegn og styrke {minScore}/4. Højst 128 tegn (512 UTF-8-bytes).",
  fo: "Við beinleiðis flyting má sysPass ikki samstundis skriva í sama dátugrunn. Tak fyrst eitt serstakt trygdaravrit av dátugrunninum og config.xml. nodePass ger eisini eitt trygdaravrit undan flytingini.|Fyll henda teig út.|Í mesta lagi {max} stavtekn.|Í mesta lagi {max} UTF-8-být.|1–50 stavtekn: bókstavir, tøl og _ . {'@'} -|Í minsta lagi {minLength} stavtekn og styrki {minScore}/4. Í mesta lagi 128 stavtekn (512 UTF-8-být).",
  ja_JP:
    "直接移行する場合、sysPassが同じデータベースに同時に書き込まないようにしてください。事前にデータベースとconfig.xmlを別途バックアップしてください。nodePassも移行前にバックアップを作成します。|この項目を入力してください。|{max}文字以内にしてください。|UTF-8で{max}バイト以内にしてください。|1～50文字：文字、数字、および _ . {'@'} -|{minLength}文字以上、強度{minScore}/4以上。最大128文字（UTF-8で512バイト）。",
};

export const setupMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, row]) => {
    const values = row.split("|");
    if (values.length !== keys.length)
      throw new Error(`Incomplete setup translations: ${locale}`);
    return [
      locale,
      Object.fromEntries(keys.map((key, i) => [key, values[i]!])),
    ];
  }),
);
