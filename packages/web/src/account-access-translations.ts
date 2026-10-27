import type { Language } from "@nodepass/contracts";

const rows: Record<Language, [string, string, string, string]> = {
  de_DE: [
    "Kontenzugriff",
    "Sekundärgruppen-Zugriff",
    "Aus: Eine zusätzliche Gruppenfreigabe am Konto gilt nur für Benutzer mit dieser primären Gruppe. Ein: Auch zusätzliche Gruppenmitgliedschaften der Benutzer werden berücksichtigt. Mitgliedschaften in der Hauptgruppe eines nicht privaten Kontos gelten unabhängig davon.",
    "Private Konten bleiben dem Eigentümer vorbehalten. Gruppenprivate Konten erfordern dieselbe primäre Gruppe. Profilrechte und diese Einschränkungen gelten auch für den Passwortverlauf.",
  ],
  en_US: [
    "Account access",
    "Secondary groups access",
    "Off: An additional group grant on an account applies only to users with that primary group. On: Users' additional group memberships also qualify. Membership in a non-private account's main group applies independently.",
    "Personal private accounts remain restricted to their owner. Group-private accounts require the same primary group. Profile permissions and these restrictions also apply to password history.",
  ],
  es_ES: [
    "Acceso a cuentas",
    "Acceso de grupos secundarios",
    "Desactivado: Un permiso de grupo adicional de una cuenta solo se aplica a usuarios cuyo grupo principal coincida. Activado: También se consideran sus grupos adicionales. La pertenencia al grupo principal de una cuenta no privada se aplica de forma independiente.",
    "Las cuentas privadas se reservan a su propietario. Las cuentas privadas de grupo requieren el mismo grupo principal. Los permisos del perfil y estas restricciones también se aplican al historial de contraseñas.",
  ],
  ca_ES: [
    "Accés als comptes",
    "Accés de grups secundaris",
    "Desactivat: Un permís de grup addicional d’un compte només s’aplica als usuaris amb aquest grup principal. Activat: També es consideren els seus grups addicionals. La pertinença al grup principal d’un compte no privat s’aplica de manera independent.",
    "Els comptes privats es reserven al propietari. Els comptes privats de grup requereixen el mateix grup principal. Els permisos del perfil i aquestes restriccions també s’apliquen a l’historial de contrasenyes.",
  ],
  hu_HU: [
    "Fiókhozzáférés",
    "Másodlagos csoportok hozzáférése",
    "Kikapcsolva: A fiók további csoportengedélye csak az ilyen elsődleges csoportú felhasználókra érvényes. Bekapcsolva: A felhasználók további csoporttagsága is számít. A nem privát fiók főcsoportjában való tagság ettől függetlenül érvényes.",
    "A privát fiókokhoz csak a tulajdonos férhet hozzá. A csoportprivát fiókok azonos elsődleges csoportot igényelnek. A profilengedélyek és ezek a korlátozások a jelszóelőzményekre is érvényesek.",
  ],
  fr_FR: [
    "Accès aux comptes",
    "Accès des groupes secondaires",
    "Désactivé : Une autorisation de groupe supplémentaire d’un compte ne concerne que les utilisateurs ayant ce groupe principal. Activé : Leurs groupes supplémentaires sont également pris en compte. L’appartenance au groupe principal d’un compte non privé s’applique indépendamment.",
    "Les comptes privés restent réservés à leur propriétaire. Les comptes privés de groupe exigent le même groupe principal. Les droits du profil et ces restrictions s’appliquent aussi à l’historique des mots de passe.",
  ],
  pl_PL: [
    "Dostęp do kont",
    "Dostęp grup dodatkowych",
    "Wyłączone: Dodatkowe uprawnienie grupowe konta dotyczy tylko użytkowników z taką grupą podstawową. Włączone: Uwzględniane są też dodatkowe grupy użytkowników. Członkostwo w głównej grupie konta nieprywatnego działa niezależnie.",
    "Konta prywatne są dostępne tylko dla właściciela. Konta prywatne grupy wymagają tej samej grupy podstawowej. Uprawnienia profilu i te ograniczenia dotyczą też historii haseł.",
  ],
  ru_RU: [
    "Доступ к учётным записям",
    "Доступ вторичных групп",
    "Выключено: Дополнительное групповое разрешение записи действует только для пользователей с этой основной группой. Включено: Учитываются и дополнительные группы пользователей. Членство в главной группе неприватной записи действует независимо.",
    "Личные приватные записи доступны только владельцу. Приватные записи группы требуют той же основной группы. Права профиля и эти ограничения действуют и для истории паролей.",
  ],
  nl_NL: [
    "Accounttoegang",
    "Toegang via secundaire groepen",
    "Uit: Een aanvullende groepstoekenning van een account geldt alleen voor gebruikers met die primaire groep. Aan: Ook aanvullende groepslidmaatschappen tellen mee. Lidmaatschap van de hoofdgroep van een niet-privéaccount geldt onafhankelijk hiervan.",
    "Privéaccounts blijven beperkt tot de eigenaar. Groepsprivéaccounts vereisen dezelfde primaire groep. Profielrechten en deze beperkingen gelden ook voor de wachtwoordgeschiedenis.",
  ],
  pt_BR: [
    "Acesso às contas",
    "Acesso de grupos secundários",
    "Desativado: Uma permissão de grupo adicional de uma conta vale apenas para usuários com esse grupo principal. Ativado: Os grupos adicionais dos usuários também são considerados. A participação no grupo principal de uma conta não privada vale de forma independente.",
    "Contas privadas ficam restritas ao proprietário. Contas privadas de grupo exigem o mesmo grupo principal. As permissões do perfil e essas restrições também se aplicam ao histórico de senhas.",
  ],
  it_IT: [
    "Accesso agli account",
    "Accesso dei gruppi secondari",
    "Disattivato: Un permesso di gruppo aggiuntivo di un account vale solo per gli utenti con quel gruppo principale. Attivato: Sono considerati anche i gruppi aggiuntivi degli utenti. L’appartenenza al gruppo principale di un account non privato vale indipendentemente.",
    "Gli account privati restano riservati al proprietario. Gli account privati di gruppo richiedono lo stesso gruppo principale. I permessi del profilo e queste restrizioni valgono anche per la cronologia delle password.",
  ],
  da: [
    "Kontoadgang",
    "Adgang via sekundære grupper",
    "Fra: En ekstra gruppetilladelse på en konto gælder kun brugere med denne primære gruppe. Til: Brugernes ekstra gruppemedlemskaber tæller også. Medlemskab af en ikke-privat kontos hovedgruppe gælder uafhængigt heraf.",
    "Private konti er forbeholdt ejeren. Gruppeprivate konti kræver samme primære gruppe. Profilrettigheder og disse begrænsninger gælder også adgangskodehistorikken.",
  ],
  fo: [
    "Atgongd til kontur",
    "Atgongd hjá sekundærum bólkum",
    "Frá: Ein eyka bólkaheimild á eini kontu er bert galdandi fyri brúkarar við hesum høvuðsbólki. Til: Eyka bólkalimaskapur hjá brúkarum telur eisini við. Limaskapur í høvuðsbólkinum hjá eini ikki-privatari kontu er galdandi óheft av hesum.",
    "Privatar kontur eru bert fyri eigaran. Bólkaprivatar kontur krevja sama høvuðsbólk. Vangamyndarheimildir og hesar avmarkingar galda eisini fyri loyniorðasøguna.",
  ],
  ja_JP: [
    "アカウントへのアクセス",
    "セカンダリグループのアクセス",
    "オフ：アカウントに追加されたグループ権限は、そのグループをプライマリグループとするユーザーにのみ適用されます。オン：ユーザーの追加グループも対象になります。非公開でないアカウントのメイングループへの所属は、この設定に関係なく有効です。",
    "個人の非公開アカウントは所有者のみ利用できます。グループ非公開アカウントには同じプライマリグループが必要です。プロファイル権限とこれらの制限は、パスワード履歴にも適用されます。",
  ],
};
export const accountAccessMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, values]) => [
    locale,
    Object.fromEntries(
      [
        "accountAccessTitle",
        "secondaryGroupAccess",
        "secondaryGroupAccessHelp",
        "privateGroupAccessHelp",
      ].map((key, index) => [key, values[index]]),
    ),
  ]),
);
