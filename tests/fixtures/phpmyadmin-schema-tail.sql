-- Indizes für die Tabelle `Account`
--
ALTER TABLE `Account`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_Account_01` (`categoryId`),
  ADD KEY `idx_Account_02` (`userGroupId`,`userId`),
  ADD KEY `idx_Account_03` (`clientId`),
  ADD KEY `idx_Account_04` (`parentId`),
  ADD KEY `fk_Account_userId` (`userId`),
  ADD KEY `fk_Account_userEditId` (`userEditId`);

ALTER TABLE `AccountFile`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_AccountFile_accountId` (`accountId`);

ALTER TABLE `User`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `login` (`login`);

-- AUTO_INCREMENT für exportierte Tabellen
ALTER TABLE `Account`
  MODIFY `id` mediumint(8) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=100;
ALTER TABLE `AccountFile`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=100;
ALTER TABLE `User`
  MODIFY `id` smallint(5) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=100;

-- Constraints der exportierten Tabellen
ALTER TABLE `Account`
  ADD CONSTRAINT `fk_Account_categoryId` FOREIGN KEY (`categoryId`) REFERENCES `Category` (`id`),
  ADD CONSTRAINT `fk_Account_clientId` FOREIGN KEY (`clientId`) REFERENCES `Client` (`id`),
  ADD CONSTRAINT `fk_Account_userGroupId` FOREIGN KEY (`userGroupId`) REFERENCES `UserGroup` (`id`),
  ADD CONSTRAINT `fk_Account_userId` FOREIGN KEY (`userId`) REFERENCES `User` (`id`),
  ADD CONSTRAINT `fk_Account_userEditId` FOREIGN KEY (`userEditId`) REFERENCES `User` (`id`);
ALTER TABLE `AccountFile`
  ADD CONSTRAINT `fk_AccountFile_accountId` FOREIGN KEY (`accountId`) REFERENCES `Account` (`id`);
