# Origin and attribution

nodePass is licensed under **GPL-3.0-or-later**; the full GNU GPL version 3 text is in [COPYING](COPYING). It is an independent successor to sysPass, not an official release or a claim of endorsement by its authors.

## sysPass reference material

The compatibility baseline is the sysPass 3.2.11 source distribution (build `3211.22070201`, schema `310.19042701`) from [sysPass](https://github.com/nuxsmin/sysPass). sysPass copyright belongs to its original authors and contributors, including Rubén Domínguez. This attribution does not transfer their authorship to nodePass.

Derived/copied material includes:

- `packages/server/resources/schema.sql`: the 27 base-table definitions derived from upstream `schemas/dbstructure.sql`; `schema.json` describes that baseline.
- `tests/fixtures/syspass-account-crypt.xml`: upstream `tests/res/datasets/syspass_accountCrypt.xml`.
- `tests/fixtures/config.xml`: upstream `tests/res/config/config.xml`.
- Compatibility behavior informed by upstream configuration, serialization, encryption, API and Authenticator data formats. The new application does not execute upstream PHP.

The copied test fixtures are reference test material, not live credentials or deployment configuration. Existing license notices remain applicable.

## Independent reference generator and dependencies

`tests/reference.php` generates synthetic interoperability vectors using Defuse PHP Encryption v2.3.1, commit `77880488b9954b7884c25555c2a0ea9e7053f9d2`, from [defuse/php-encryption](https://github.com/defuse/php-encryption). The library is fetched for verification and retains its own license. The application does not distribute or execute PHP as its runtime.

Other dependencies retain their respective licenses and notices. `package-lock.json` records resolved JavaScript packages; CI produces an image SBOM as an artifact. `COPYING` is the project license text, not an assertion that all third-party components have the same license.
