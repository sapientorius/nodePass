<?php
// Test data only. Generate using Defuse v2.3.1 commit 77880488b9954b7884c25555c2a0ea9e7053f9d2.
// This script and the compatibility model below are GPL-3.0-or-later.
namespace SP\Modules\Web\Plugins\Authenticator\Models {
    class AuthenticatorData {
        public $userId = 1;
        public $twofaEnabled = 1;
        public $date = 1700000000;
        public $expireDays = 0;
        public $IV = 'JBSWY3DPEHPK3PXP';
        public $recoveryCodes = ['synthetic-recovery-code-1'];
        public $lastRecoveryTime = 0;
    }
}
namespace SP\Core\Crypt {
    class Vault {
        private $data;
        private $key;
        private $timeSet = 1700000000;
        private $timeUpdated = 0;
        function __construct($clear, $password) {
            $key = \Defuse\Crypto\KeyProtectedByPassword::createRandomPasswordProtectedKey($password);
            $this->key = $key->saveToAsciiSafeString();
            $this->data = \Defuse\Crypto\Crypto::encrypt($clear, $key->unlockKey($password));
        }
    }
}
namespace {
    spl_autoload_register(function ($class) {
        $prefix = 'Defuse\\Crypto\\';
        if (strpos($class, $prefix) === 0) {
            require '/workspace/.cache/defuse/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        }
    });
    $master = '12345678900';
    function encrypted($clear, $password) {
        $key = \Defuse\Crypto\KeyProtectedByPassword::createRandomPasswordProtectedKey($password);
        return ['pass' => \Defuse\Crypto\Crypto::encrypt($clear, $key->unlockKey($password)), 'key' => $key->saveToAsciiSafeString()];
    }
    $passwords = ['', str_repeat('a',72), str_repeat('a',73), str_repeat('日',72), str_repeat('😀',73), '  synthetic password  '];
    $hashes = [];
    foreach ($passwords as $password) {
        $characters = preg_match_all('/./us', $password);
        $prepared = $characters > 72 ? hash('sha256',$password) : $password;
        $hashes[] = ['password'=>$password,'hash'=>password_hash($prepared,PASSWORD_BCRYPT)];
    }
    $account = ['name'=>'Synthetic account','login'=>'reference','url'=>'https://example.invalid','notes'=>'Test only','pass'=>'synthetic secret'];
    $salt = 'synthetic-public-link-salt';
    $hash = str_repeat('a',64);
    $public = serialize(new \SP\Core\Crypt\Vault(serialize($account),sha1($salt.$hash)));
    $result = [
        'source'=>'Defuse PHP v2.3.1 / sysPass 3.2.11',
        'master'=>$master,
        'hashes'=>$hashes,
        'secret'=>encrypted("日本語\0secret",$master),
        'plugin'=>encrypted(serialize(new \SP\Modules\Web\Plugins\Authenticator\Models\AuthenticatorData()),$master),
        'publicLink'=>['salt'=>$salt,'hash'=>$hash,'serialized'=>base64_encode($public),'expected'=>$account]
    ];
    $output = getenv('NODEPASS_REFERENCE_OUTPUT') ?: '/workspace/tests/fixtures/reference.json';
    if (file_put_contents($output, json_encode($result,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE)."\n") === false) {
        throw new \RuntimeException('Cannot write independent reference fixture');
    }
    echo "Generated synthetic PHP reference data\n";
}
