import type { Language } from "@nodepass/contracts";

const keys =
  "confirmIdentity|confirmMethod|confirmPasskey|confirmActionHelp|confirmResumeHelp|confirmUnavailable|confirmLoadError|confirmInvalid|confirmPasskeyError|confirmRateLimit|confirmRetry|confirmPasskeyMethod".split(
    "|",
  );
const rows: Record<Language, string> = {
  de_DE:
    "Identität bestätigen|Bestätigungsmethode|Mit Passkey bestätigen|Bestätige deine Identität für diese sicherheitskritische Aktion.|Nach der Bestätigung wird die angeforderte Aktion automatisch fortgesetzt. Deine Eingaben bleiben erhalten.|Für diesen Zugang ist keine Bestätigungsmethode verfügbar.|Die Bestätigungsmethoden konnten nicht geladen werden. Versuche es erneut.|Die Bestätigung ist fehlgeschlagen. Prüfe dein Passwort oder deinen Code und versuche es erneut.|Der Passkey konnte nicht bestätigt werden. Versuche es erneut oder wähle eine andere Methode.|Zu viele Versuche. Warte etwas, bevor du es erneut versuchst.|Erneut versuchen|Passkey",
  en_US:
    "Confirm your identity|Confirmation method|Confirm with a passkey|Confirm your identity for this security-sensitive action.|After confirmation, the requested action continues automatically. Your entries are preserved.|No confirmation method is available for this account.|Could not load confirmation methods. Please try again.|Confirmation failed. Check your password or code and try again.|The passkey could not be confirmed. Try again or choose another method.|Too many attempts. Wait a while before trying again.|Try again|Passkey",
  es_ES:
    "Confirma tu identidad|Método de confirmación|Confirmar con clave de acceso|Confirma tu identidad para esta acción sensible.|Tras la confirmación, la acción solicitada continuará automáticamente. Se conservarán tus datos introducidos.|No hay ningún método de confirmación disponible para esta cuenta.|No se pudieron cargar los métodos de confirmación. Inténtalo de nuevo.|La confirmación ha fallado. Revisa tu contraseña o código e inténtalo de nuevo.|No se pudo confirmar la clave de acceso. Inténtalo de nuevo o elige otro método.|Demasiados intentos. Espera un poco antes de volver a intentarlo.|Intentar de nuevo|Clave de acceso",
  ca_ES:
    "Confirma la teva identitat|Mètode de confirmació|Confirma amb una clau d’accés|Confirma la teva identitat per a aquesta acció sensible.|Després de confirmar, l’acció sol·licitada continuarà automàticament. Es conservaran les dades introduïdes.|Aquest compte no té cap mètode de confirmació disponible.|No s’han pogut carregar els mètodes de confirmació. Torna-ho a provar.|La confirmació ha fallat. Revisa la contrasenya o el codi i torna-ho a provar.|No s’ha pogut confirmar la clau d’accés. Torna-ho a provar o tria un altre mètode.|Massa intents. Espera una estona abans de tornar-ho a provar.|Torna-ho a provar|Clau d’accés",
  hu_HU:
    "Személyazonosság megerősítése|Megerősítés módja|Megerősítés hozzáférési kulccsal|Erősítse meg személyazonosságát ehhez a biztonsági szempontból érzékeny művelethez.|A megerősítés után a kért művelet automatikusan folytatódik. A megadott adatok megmaradnak.|Ehhez a fiókhoz nem áll rendelkezésre megerősítési mód.|Nem sikerült betölteni a megerősítési módokat. Próbálja újra.|A megerősítés sikertelen. Ellenőrizze a jelszót vagy a kódot, és próbálja újra.|A hozzáférési kulcs megerősítése sikertelen. Próbálja újra, vagy válasszon másik módot.|Túl sok próbálkozás. Várjon egy kicsit az újabb próbálkozás előtt.|Újrapróbálkozás|Hozzáférési kulcs",
  fr_FR:
    "Confirmer votre identité|Méthode de confirmation|Confirmer avec une clé d’accès|Confirmez votre identité pour cette action sensible.|Après confirmation, l’action demandée reprend automatiquement. Vos saisies sont conservées.|Aucune méthode de confirmation n’est disponible pour ce compte.|Impossible de charger les méthodes de confirmation. Réessayez.|La confirmation a échoué. Vérifiez votre mot de passe ou votre code et réessayez.|La clé d’accès n’a pas pu être confirmée. Réessayez ou choisissez une autre méthode.|Trop de tentatives. Patientez avant de réessayer.|Réessayer|Clé d’accès",
  pl_PL:
    "Potwierdź swoją tożsamość|Metoda potwierdzenia|Potwierdź kluczem dostępu|Potwierdź swoją tożsamość, aby wykonać tę operację związaną z bezpieczeństwem.|Po potwierdzeniu żądana operacja zostanie automatycznie wznowiona. Wprowadzone dane zostaną zachowane.|Dla tego konta nie ma dostępnej metody potwierdzenia.|Nie udało się wczytać metod potwierdzenia. Spróbuj ponownie.|Potwierdzenie nie powiodło się. Sprawdź hasło lub kod i spróbuj ponownie.|Nie udało się potwierdzić klucza dostępu. Spróbuj ponownie lub wybierz inną metodę.|Zbyt wiele prób. Odczekaj chwilę przed kolejną próbą.|Spróbuj ponownie|Klucz dostępu",
  ru_RU:
    "Подтвердите личность|Способ подтверждения|Подтвердить ключом доступа|Подтвердите личность для выполнения этого действия, связанного с безопасностью.|После подтверждения запрошенное действие продолжится автоматически. Введённые данные сохранятся.|Для этой учётной записи нет доступного способа подтверждения.|Не удалось загрузить способы подтверждения. Попробуйте ещё раз.|Подтверждение не удалось. Проверьте пароль или код и попробуйте ещё раз.|Не удалось подтвердить ключ доступа. Попробуйте ещё раз или выберите другой способ.|Слишком много попыток. Подождите перед следующей попыткой.|Повторить|Ключ доступа",
  nl_NL:
    "Bevestig je identiteit|Bevestigingsmethode|Bevestigen met een toegangssleutel|Bevestig je identiteit voor deze beveiligingsgevoelige actie.|Na bevestiging wordt de gevraagde actie automatisch voortgezet. Je invoer blijft behouden.|Er is geen bevestigingsmethode beschikbaar voor dit account.|De bevestigingsmethoden konden niet worden geladen. Probeer het opnieuw.|Bevestiging mislukt. Controleer je wachtwoord of code en probeer het opnieuw.|De toegangssleutel kon niet worden bevestigd. Probeer het opnieuw of kies een andere methode.|Te veel pogingen. Wacht even voordat je het opnieuw probeert.|Opnieuw proberen|Toegangssleutel",
  pt_BR:
    "Confirme sua identidade|Método de confirmação|Confirmar com chave de acesso|Confirme sua identidade para esta ação sensível à segurança.|Após a confirmação, a ação solicitada continua automaticamente. Os dados inseridos são preservados.|Nenhum método de confirmação está disponível para esta conta.|Não foi possível carregar os métodos de confirmação. Tente novamente.|A confirmação falhou. Confira sua senha ou código e tente novamente.|Não foi possível confirmar a chave de acesso. Tente novamente ou escolha outro método.|Muitas tentativas. Aguarde um pouco antes de tentar novamente.|Tentar novamente|Chave de acesso",
  it_IT:
    "Conferma la tua identità|Metodo di conferma|Conferma con una chiave di accesso|Conferma la tua identità per questa azione sensibile per la sicurezza.|Dopo la conferma, l’azione richiesta riprende automaticamente. I dati inseriti vengono conservati.|Non è disponibile alcun metodo di conferma per questo account.|Impossibile caricare i metodi di conferma. Riprova.|Conferma non riuscita. Controlla la password o il codice e riprova.|Impossibile confermare la chiave di accesso. Riprova o scegli un altro metodo.|Troppi tentativi. Attendi prima di riprovare.|Riprova|Chiave di accesso",
  da: "Bekræft din identitet|Bekræftelsesmetode|Bekræft med en adgangsnøgle|Bekræft din identitet for denne sikkerhedsfølsomme handling.|Efter bekræftelsen fortsætter den ønskede handling automatisk. Dine indtastninger bevares.|Der er ingen tilgængelig bekræftelsesmetode for denne konto.|Bekræftelsesmetoderne kunne ikke indlæses. Prøv igen.|Bekræftelsen mislykkedes. Kontrollér din adgangskode eller kode, og prøv igen.|Adgangsnøglen kunne ikke bekræftes. Prøv igen, eller vælg en anden metode.|For mange forsøg. Vent lidt, før du prøver igen.|Prøv igen|Adgangsnøgle",
  fo: "Vátta tín samleika|Váttanarháttur|Vátta við atgongulykli|Vátta tín samleika fyri hesa trygdarviðkvæmu gerð.|Eftir váttan heldur umbidna gerðin sjálvvirkandi fram. Tínar inntøkur verða varðveittar.|Eingin váttanarháttur er tøkur fyri hesa kontu.|Váttanarhættirnir kundu ikki lesast inn. Royn aftur.|Váttanin miseydnaðist. Kanna loyniorðið ella kotuna og royn aftur.|Atgongulykilin kundi ikki váttast. Royn aftur ella vel ein annan hátt.|Ov nógvar royndir. Bíða eina løtu, áðrenn tú roynir aftur.|Royn aftur|Atgongulykil",
  ja_JP:
    "本人確認|確認方法|パスキーで確認|このセキュリティ上重要な操作のために本人確認を行ってください。|確認後、要求された操作が自動的に再開されます。入力内容は保持されます。|このアカウントでは利用できる確認方法がありません。|確認方法を読み込めませんでした。もう一度お試しください。|確認に失敗しました。パスワードまたはコードを確認して、もう一度お試しください。|パスキーで確認できませんでした。もう一度試すか、別の方法を選んでください。|試行回数が多すぎます。しばらく待ってからもう一度お試しください。|再試行|パスキー",
};
export const confirmationMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, row]) => {
    const values = row.split("|");
    if (values.length !== keys.length)
      throw new Error(`Incomplete confirmation translations: ${locale}`);
    return [
      locale,
      Object.fromEntries(keys.map((key, index) => [key, values[index]!])),
    ];
  }),
);
