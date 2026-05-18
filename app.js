// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
        console.log('Service Worker registration failed:', err);
    });
}

function bytesToBase64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function textToBytes(value) {
    return new TextEncoder().encode(value);
}

function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

class SecurityManager {
    constructor() {
        this.PIN_HASH_KEY = 'ministering_app_pin_hash';
        this.PIN_SALT_KEY = 'ministering_app_pin_salt';
        this.PIN_ITERATIONS_KEY = 'ministering_app_pin_iterations';
        this.BIOMETRIC_CREDENTIAL_KEY = 'ministering_app_biometric_credential';
        this.BIOMETRIC_ENABLED_KEY = 'ministering_app_biometric_enabled';
        this.SESSION_KEY = 'ministering_app_unlocked';
        this.DEFAULT_ITERATIONS = 150000;
    }

    hasPin() {
        return Boolean(localStorage.getItem(this.PIN_HASH_KEY) && localStorage.getItem(this.PIN_SALT_KEY));
    }

    isUnlocked() {
        return sessionStorage.getItem(this.SESSION_KEY) === 'true';
    }

    unlock() {
        sessionStorage.setItem(this.SESSION_KEY, 'true');
    }

    lock() {
        sessionStorage.removeItem(this.SESSION_KEY);
    }

    canUseBiometrics() {
        return Boolean(window.isSecureContext && navigator.credentials && typeof navigator.credentials.create === 'function' && typeof navigator.credentials.get === 'function' && window.PublicKeyCredential);
    }

    hasBiometricCredential() {
        return Boolean(localStorage.getItem(this.BIOMETRIC_CREDENTIAL_KEY));
    }

    isBiometricEnabled() {
        return localStorage.getItem(this.BIOMETRIC_ENABLED_KEY) === 'true';
    }

    setBiometricEnabled(enabled) {
        if (enabled) {
            localStorage.setItem(this.BIOMETRIC_ENABLED_KEY, 'true');
        } else {
            localStorage.removeItem(this.BIOMETRIC_ENABLED_KEY);
            this.clearBiometricCredential();
        }
    }

    async deriveHash(pin, saltBytes, iterations) {
        const key = await crypto.subtle.importKey('raw', textToBytes(pin), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256'
        }, key, 256);
        return new Uint8Array(bits);
    }

    async setPin(pin) {
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const iterations = this.DEFAULT_ITERATIONS;
        const hashBytes = await this.deriveHash(pin, saltBytes, iterations);
        localStorage.setItem(this.PIN_SALT_KEY, bytesToBase64Url(saltBytes));
        localStorage.setItem(this.PIN_HASH_KEY, bytesToBase64Url(hashBytes));
        localStorage.setItem(this.PIN_ITERATIONS_KEY, String(iterations));
        this.unlock();
    }

    async verifyPin(pin) {
        const saltValue = localStorage.getItem(this.PIN_SALT_KEY);
        const hashValue = localStorage.getItem(this.PIN_HASH_KEY);
        if (!saltValue || !hashValue) {
            return false;
        }

        const iterations = Number(localStorage.getItem(this.PIN_ITERATIONS_KEY) || this.DEFAULT_ITERATIONS);
        const derivedHash = await this.deriveHash(pin, base64UrlToBytes(saltValue), iterations);
        return bytesToBase64Url(derivedHash) === hashValue;
    }

    clearBiometricCredential() {
        localStorage.removeItem(this.BIOMETRIC_CREDENTIAL_KEY);
    }

    async enrollBiometric() {
        if (!this.canUseBiometrics()) {
            throw new Error('Biometrics are not available in this browser or context.');
        }

        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));
        const credential = await navigator.credentials.create({
            publicKey: {
                challenge,
                rp: {
                    name: 'Ministering Contacts'
                },
                user: {
                    id: userId,
                    name: 'ministering-user',
                    displayName: 'Ministering User'
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 }
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required'
                },
                timeout: 60000,
                attestation: 'none'
            }
        });

        if (!credential || !credential.rawId) {
            throw new Error('Biometric setup was cancelled.');
        }

        localStorage.setItem(this.BIOMETRIC_CREDENTIAL_KEY, bytesToBase64Url(new Uint8Array(credential.rawId)));
        this.setBiometricEnabled(true);
        return true;
    }

    async unlockWithBiometric() {
        if (!this.canUseBiometrics() || !this.isBiometricEnabled() || !this.hasBiometricCredential()) {
            return false;
        }

        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const credentialId = base64UrlToBytes(localStorage.getItem(this.BIOMETRIC_CREDENTIAL_KEY));
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge,
                allowCredentials: [
                    { type: 'public-key', id: credentialId }
                ],
                userVerification: 'required',
                timeout: 60000
            }
        });

        if (!assertion) {
            return false;
        }

        this.unlock();
        return true;
    }
}

// Contact Storage Manager
class ContactManager {
    constructor() {
        this.STORAGE_KEY = 'ministering_contacts';
        this.contacts = this.loadContacts();
    }

    loadContacts() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Error loading contacts:', e);
            return [];
        }
    }

    saveContacts() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.contacts));
            return true;
        } catch (e) {
            console.error('Error saving contacts:', e);
            alert('Failed to save contacts. Storage may be full.');
            return false;
        }
    }

    addContact(contact) {
        contact.id = Date.now().toString();
        this.contacts.push(contact);
        this.saveContacts();
        return contact;
    }

    updateContact(id, contact) {
        const index = this.contacts.findIndex(c => c.id === id);
        if (index !== -1) {
            this.contacts[index] = { ...this.contacts[index], ...contact, id };
            this.saveContacts();
            return this.contacts[index];
        }
        return null;
    }

    deleteContact(id) {
        const index = this.contacts.findIndex(c => c.id === id);
        if (index !== -1) {
            this.contacts.splice(index, 1);
            this.saveContacts();
            return true;
        }
        return false;
    }

    getContact(id) {
        return this.contacts.find(c => c.id === id);
    }

    getAllContacts() {
        return this.contacts;
    }

    importCSV(csvText) {
        const lines = csvText.trim().split('\n');
        let imported = 0;

        lines.forEach((line, index) => {
            if (index === 0) return; // Skip header
            const parts = line.split(',').map(p => p.trim());
            if (parts.length > 0 && parts[0]) {
                const contact = {
                    name: parts[0] || '',
                    phone: parts[1] || '',
                    email: parts[2] || '',
                    birthday: parts[3] || ''
                };
                this.addContact(contact);
                imported++;
            }
        });

        return imported;
    }

    importVCard(vcardText) {
        const contacts = [];
        const vCards = vcardText.split('END:VCARD');

        vCards.forEach(vcard => {
            if (!vcard.includes('BEGIN:VCARD')) return;

            const contact = {
                name: this.extractVCardField(vcard, 'FN') || '',
                phone: this.extractVCardField(vcard, 'TEL') || '',
                email: this.extractVCardField(vcard, 'EMAIL') || '',
                birthday: this.extractVCardField(vcard, 'BDAY') || ''
            };

            if (contact.name) {
                this.addContact(contact);
                contacts.push(contact);
            }
        });

        return contacts.length;
    }

    extractVCardField(vcard, field) {
        const regex = new RegExp(`${field}:(.+?)(?:\r?\n|$)`, 'i');
        const match = vcard.match(regex);
        if (match) {
            return match[1].split(';').pop().trim();
        }
        return '';
    }
}

// UI Manager
class UIManager {
    constructor(contactManager, securityManager) {
        this.contactManager = contactManager;
        this.securityManager = securityManager;
        this.currentEditId = null;
        this.sharedData = null;
        this.securityMode = 'unlock';
        this.biometricPromptCanceled = false;
        this.biometricPromptInProgress = false;
        this.initElements();
        this.attachEventListeners();
        this.render();
        this.initializeSecurity();
    }

    initElements() {
        // Views
        this.contactsView = document.getElementById('contactsView');
        this.formView = document.getElementById('formView');
        this.shareView = document.getElementById('shareView');

        // Contacts
        this.contactsList = document.getElementById('contactsList');
        this.emptyState = document.getElementById('emptyState');

        // Buttons
        this.addContactBtn = document.getElementById('addContactBtn');
        this.importBtn = document.getElementById('importBtn');
        this.securityBtn = document.getElementById('securityBtn');
        this.cancelBtn = document.getElementById('cancelBtn');
        this.importFile = document.getElementById('importFile');

        // Form
        this.contactForm = document.getElementById('contactForm');
        this.formTitle = document.getElementById('formTitle');
        this.nameInput = document.getElementById('name');
        this.phoneInput = document.getElementById('phone');
        this.emailInput = document.getElementById('email');
        this.birthdayInput = document.getElementById('birthday');
        this.notesInput = document.getElementById('notes');

        // Share
        this.shareContactsList = document.getElementById('shareContactsList');
        this.sharedContent = document.getElementById('sharedContent');

        // Modal
        this.confirmDialog = document.getElementById('confirmDialog');
        this.modalOverlay = document.getElementById('modalOverlay');
        this.confirmTitle = document.getElementById('confirmTitle');
        this.confirmMessage = document.getElementById('confirmMessage');
        this.confirmYes = document.getElementById('confirmYes');
        this.confirmNo = document.getElementById('confirmNo');

        // Security modal
        this.securityDialog = document.getElementById('securityDialog');
        this.securityTitle = document.getElementById('securityTitle');
        this.securityMessage = document.getElementById('securityMessage');
        this.securityForm = document.getElementById('securityForm');
        this.securityPinInput = document.getElementById('securityPin');
        this.securityPinConfirmInput = document.getElementById('securityPinConfirm');
        this.securityConfirmGroup = document.getElementById('securityConfirmGroup');
        this.securityBiometricOptIn = document.getElementById('securityBiometricOptIn');
        this.securityHint = document.getElementById('securityHint');
        this.securityCancel = document.getElementById('securityCancel');
        this.securityBiometricBtn = document.getElementById('securityBiometricBtn');
        this.securitySubmit = document.getElementById('securitySubmit');
    }

    attachEventListeners() {
        this.addContactBtn.addEventListener('click', () => this.handleAddContact());
        this.importBtn.addEventListener('click', () => this.importFile.click());
        this.securityBtn.addEventListener('click', () => this.openSecuritySettings());
        this.cancelBtn.addEventListener('click', () => this.showContactsView());
        this.contactForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        this.importFile.addEventListener('change', (e) => this.handleImport(e));
        this.confirmYes.addEventListener('click', () => this.confirmDelete());
        this.confirmNo.addEventListener('click', () => this.closeModal());
        this.securityForm.addEventListener('submit', (e) => this.handleSecuritySubmit(e));
        this.securityCancel.addEventListener('click', () => this.closeSecurityDialog());
        this.securityBiometricBtn.addEventListener('click', () => this.handleBiometricAction());
        this.securityBiometricOptIn.addEventListener('change', () => this.handleBiometricToggleChange());
        this.modalOverlay.addEventListener('click', () => this.handleOverlayClick());

        // Check for shared data
        this.checkForSharedData();
    }

    async initializeSecurity() {
        const locked = !this.securityManager.isUnlocked();
        document.body.classList.toggle('app-locked', locked);

        if (!this.securityManager.hasPin()) {
            this.openSecurityDialog('setup');
            return;
        }

        if (locked) {
            this.openSecurityDialog('unlock');
            return;
        }

        this.closeSecurityDialog();
    }

    openSecuritySettings() {
        if (!this.securityManager.hasPin()) {
            this.openSecurityDialog('setup');
            return;
        }

        if (!this.securityManager.isUnlocked()) {
            this.openSecurityDialog('unlock');
            return;
        }

        this.openSecurityDialog('manage');
    }

    openSecurityDialog(mode) {
        this.securityMode = mode;
        this.resetSecurityDialog();
        this.configureSecurityDialog(mode);
        document.body.classList.add('app-locked');
        this.securityDialog.classList.remove('hidden');
        this.modalOverlay.classList.remove('hidden');
        this.securityPinInput.focus();

        if (mode === 'unlock') {
            this.tryDefaultBiometricUnlock();
        }
    }

    closeSecurityDialog() {
        this.securityDialog.classList.add('hidden');
        this.modalOverlay.classList.add('hidden');
        document.body.classList.toggle('app-locked', !this.securityManager.isUnlocked());
    }

    handleOverlayClick() {
        if (!this.securityDialog.classList.contains('hidden')) {
            if (this.securityMode === 'manage' && this.securityManager.isUnlocked()) {
                this.closeSecurityDialog();
            }
            return;
        }

        this.closeModal();
    }

    resetSecurityDialog() {
        this.securityPinInput.value = '';
        this.securityPinConfirmInput.value = '';
        this.securityBiometricOptIn.checked = false;
        this.securityBiometricOptIn.disabled = false;
        this.biometricPromptCanceled = false;
        this.biometricPromptInProgress = false;
        this.setSecurityHint('');
    }

    setSecurityHint(message, isError = false) {
        this.securityHint.textContent = message;
        this.securityHint.classList.toggle('error', isError);
    }

    isBiometricCancelError(error) {
        return Boolean(error && (error.name === 'NotAllowedError' || error.name === 'AbortError'));
    }

    async tryDefaultBiometricUnlock() {
        const canAutostart = this.securityMode === 'unlock'
            && this.securityManager.canUseBiometrics()
            && this.securityManager.hasBiometricCredential();

        if (!canAutostart || this.biometricPromptCanceled || this.biometricPromptInProgress) {
            return;
        }

        this.biometricPromptInProgress = true;
        try {
            const unlocked = await this.securityManager.unlockWithBiometric();
            if (unlocked) {
                this.finishUnlock();
                return;
            }

            this.biometricPromptCanceled = true;
            this.setSecurityHint('Biometric unlock canceled. Enter your PIN.', true);
        } catch (error) {
            if (this.isBiometricCancelError(error)) {
                this.biometricPromptCanceled = true;
                this.setSecurityHint('Biometric unlock canceled. Enter your PIN.', true);
            } else {
                console.error('Biometric unlock failed:', error);
                this.setSecurityHint('Biometric unlock failed. Enter your PIN.', true);
            }
        } finally {
            this.biometricPromptInProgress = false;
        }
    }

    configureSecurityDialog(mode) {
        const biometricAvailable = this.securityManager.canUseBiometrics();
        const biometricEnabled = this.securityManager.isBiometricEnabled();
        const biometricEnrolled = biometricEnabled && this.securityManager.hasBiometricCredential();

        if (mode === 'setup') {
            this.securityTitle.textContent = 'Set App PIN';
            this.securityMessage.textContent = 'Create a PIN to protect your contacts.';
            this.securityConfirmGroup.classList.remove('hidden');
            this.securityBiometricOptIn.parentElement.classList.remove('hidden');
            this.securityCancel.classList.add('hidden');
            this.securityBiometricBtn.classList.add('hidden');
            this.securityBiometricOptIn.disabled = !biometricAvailable;
            this.securityBiometricOptIn.checked = biometricEnabled;
            this.securitySubmit.textContent = 'Save PIN';
            this.setSecurityHint(biometricAvailable
                ? 'Biometrics can be enabled while you save the PIN.'
                : 'Biometric unlock is unavailable on this browser or in this context.');
            return;
        }

        if (mode === 'manage') {
            this.securityTitle.textContent = 'Security Settings';
            this.securityMessage.textContent = 'Change the PIN or enable biometric unlock on this device.';
            this.securityConfirmGroup.classList.remove('hidden');
            this.securityBiometricOptIn.parentElement.classList.remove('hidden');
            this.securityCancel.classList.remove('hidden');
            this.securityBiometricBtn.classList.toggle('hidden', !biometricAvailable);
            this.securityBiometricBtn.textContent = biometricEnrolled ? 'Re-enroll biometrics' : 'Set up biometrics';
            this.securitySubmit.textContent = 'Update PIN';
            this.securityBiometricOptIn.checked = biometricEnabled;
            this.securityBiometricOptIn.disabled = !biometricAvailable;
            this.setSecurityHint(biometricAvailable
                ? 'Leave biometric enabled to keep using face or fingerprint unlock.'
                : 'Biometric setup is not available on this device.');
            return;
        }

        this.securityTitle.textContent = 'Unlock App';
        this.securityMessage.textContent = 'Enter your PIN or use biometrics to unlock the app.';
        this.securityConfirmGroup.classList.add('hidden');
        this.securityBiometricOptIn.parentElement.classList.add('hidden');
        this.securityCancel.classList.add('hidden');
        this.securityBiometricBtn.classList.toggle('hidden', !(biometricAvailable && biometricEnrolled));
        this.securityBiometricBtn.textContent = 'Unlock with biometrics';
        this.securitySubmit.textContent = 'Unlock';
        this.setSecurityHint(biometricAvailable && biometricEnrolled
            ? 'Biometric unlock is available for this device.'
            : 'Use your PIN to unlock the app.');
    }

    async handleBiometricToggleChange() {
        if (this.securityMode !== 'manage') {
            return;
        }

        const biometricAvailable = this.securityManager.canUseBiometrics();
        const shouldEnableBiometric = this.securityBiometricOptIn.checked;

        if (!biometricAvailable) {
            this.securityBiometricOptIn.checked = false;
            this.setSecurityHint('Biometric setup is not available on this device.', true);
            return;
        }

        try {
            if (!shouldEnableBiometric) {
                this.securityManager.setBiometricEnabled(false);
                this.setSecurityHint('Biometric unlock is disabled.');
                return;
            }

            if (!this.securityManager.hasBiometricCredential()) {
                await this.securityManager.enrollBiometric();
            }

            this.securityManager.setBiometricEnabled(true);
            this.setSecurityHint('Biometric unlock is enabled.');
        } catch (error) {
            console.error('Failed to update biometric setting:', error);
            this.securityBiometricOptIn.checked = false;
            this.securityManager.setBiometricEnabled(false);
            if (this.isBiometricCancelError(error)) {
                this.setSecurityHint('Biometric setup was canceled.', true);
            } else {
                this.setSecurityHint(error.message || 'Unable to update biometric setting.', true);
            }
        }
    }

    finishUnlock() {
        this.securityManager.unlock();
        document.body.classList.remove('app-locked');
        this.closeSecurityDialog();
        this.render();
    }

    async handleSecuritySubmit(e) {
        e.preventDefault();

        const pin = this.securityPinInput.value.trim();
        const confirmPin = this.securityPinConfirmInput.value.trim();
        const shouldEnableBiometric = this.securityBiometricOptIn.checked;

        if (this.securityMode === 'unlock') {
            if (!pin) {
                this.setSecurityHint('Enter your PIN to unlock the app.', true);
                return;
            }

            try {
                const valid = await this.securityManager.verifyPin(pin);
                if (!valid) {
                    this.setSecurityHint('That PIN is not correct.', true);
                    return;
                }

                this.finishUnlock();
            } catch (error) {
                console.error('Failed to verify PIN:', error);
                this.setSecurityHint('Unable to verify the PIN right now.', true);
            }
            return;
        }

        if (pin.length < 4) {
            if (this.securityMode === 'manage' && pin.length === 0 && confirmPin.length === 0) {
                this.setSecurityHint('Enter a new PIN to update it, or use Save Settings.', true);
                return;
            }
            this.setSecurityHint('Choose a PIN with at least 4 digits.', true);
            return;
        }

        if (pin !== confirmPin) {
            this.setSecurityHint('PIN entries do not match.', true);
            return;
        }

        try {
            await this.securityManager.setPin(pin);
            if (shouldEnableBiometric && this.securityManager.canUseBiometrics()) {
                try {
                    await this.securityManager.enrollBiometric();
                    this.securityManager.setBiometricEnabled(true);
                    this.setSecurityHint('PIN saved and biometric unlock is enabled.');
                } catch (biometricError) {
                    console.error('Biometric enrollment failed:', biometricError);
                    this.securityManager.setBiometricEnabled(false);
                    this.securityBiometricOptIn.checked = false;
                    this.setSecurityHint('PIN saved. Biometric setup was not completed.', true);
                }
            } else {
                this.securityManager.setBiometricEnabled(false);
            }
            this.finishUnlock();
        } catch (error) {
            console.error('Failed to save security settings:', error);
            this.setSecurityHint(error.message || 'Unable to save security settings.', true);
        }
    }

    async handleBiometricAction() {
        this.biometricPromptInProgress = true;
        try {
            if (this.securityMode === 'unlock') {
                const unlocked = await this.securityManager.unlockWithBiometric();
                if (unlocked) {
                    this.finishUnlock();
                } else {
                    this.setSecurityHint('Biometric sign-in was not completed.', true);
                }
                return;
            }

            await this.securityManager.enrollBiometric();
            this.securityBiometricOptIn.checked = true;
            this.securityManager.setBiometricEnabled(true);
            this.securityBiometricOptIn.disabled = false;
            this.setSecurityHint('Biometric unlock is now enabled for this device.');
        } catch (error) {
            console.error('Biometric action failed:', error);
            if (this.isBiometricCancelError(error)) {
                this.biometricPromptCanceled = true;
                this.setSecurityHint('Biometric sign-in was canceled.', true);
            } else {
                this.setSecurityHint(error.message || 'Biometric setup failed.', true);
            }
        } finally {
            this.biometricPromptInProgress = false;
        }
    }

    showContactsView() {
        this.formView.classList.add('hidden');
        this.shareView.classList.add('hidden');
        this.contactsView.classList.remove('hidden');
        this.render();
    }

    showFormView(contactId = null) {
        this.clearForm();
        this.currentEditId = contactId;

        if (contactId) {
            const contact = this.contactManager.getContact(contactId);
            if (contact) {
                this.formTitle.textContent = 'Edit Contact';
                this.nameInput.value = contact.name;
                this.phoneInput.value = contact.phone || '';
                this.emailInput.value = contact.email || '';
                this.birthdayInput.value = contact.birthday || '';
                this.notesInput.value = contact.notes || '';
            }
        } else {
            this.formTitle.textContent = 'Add Contact';
        }

        this.contactsView.classList.add('hidden');
        this.shareView.classList.add('hidden');
        this.formView.classList.remove('hidden');
        this.nameInput.focus();
    }

    async handleAddContact() {
        if (navigator.contacts && typeof navigator.contacts.select === 'function') {
            try {
                const selectedContacts = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });

                if (selectedContacts && selectedContacts.length > 0) {
                    const addedCount = selectedContacts.reduce((count, selectedContact) => {
                        const names = selectedContact.name || [];
                        const phones = selectedContact.tel || [];
                        const emails = selectedContact.email || [];
                        const contact = {
                            name: names[0] || 'Unnamed Contact',
                            phone: phones[0] || '',
                            email: emails[0] || '',
                            birthday: '',
                            notes: ''
                        };

                        this.contactManager.addContact(contact);
                        return count + 1;
                    }, 0);

                    if (addedCount > 0) {
                        this.render();
                        return;
                    }
                }
            } catch (error) {
                console.log('Contacts picker unavailable or cancelled:', error);
            }
        }

        this.showFormView();
    }

    showShareView(sharedData) {
        this.sharedData = sharedData;
        this.sharedContent.textContent = sharedData.text || sharedData.url || 'Shared content';
        this.renderShareContacts();
        this.contactsView.classList.add('hidden');
        this.formView.classList.add('hidden');
        this.shareView.classList.remove('hidden');
    }

    renderShareContacts() {
        this.shareContactsList.innerHTML = '';
        const contacts = this.contactManager.getAllContacts();

        if (contacts.length === 0) {
            this.shareContactsList.innerHTML = '<p style="text-align: center; color: #999;">No contacts available to share with.</p>';
            return;
        }

        contacts.forEach(contact => {
            const card = this.createContactCard(contact, true);
            this.shareContactsList.appendChild(card);
        });
    }

    render() {
        const contacts = this.contactManager.getAllContacts();

        if (contacts.length === 0) {
            this.contactsList.innerHTML = '';
            this.emptyState.classList.remove('hidden');
        } else {
            this.emptyState.classList.add('hidden');
            this.contactsList.innerHTML = '';
            contacts.forEach(contact => {
                const card = this.createContactCard(contact, false);
                this.contactsList.appendChild(card);
            });
        }
    }

    createContactCard(contact, isShareMode = false) {
        const card = document.createElement('div');
        card.className = 'contact-card';

        let detailsHTML = '';
        if (contact.phone) {
            detailsHTML += `<div class="contact-detail"><span>📱</span> ${contact.phone}</div>`;
        }
        if (contact.birthday) {
            const bday = new Date(contact.birthday);
            const formattedBday = bday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            detailsHTML += `<div class="contact-detail"><span>🎂</span> ${formattedBday}</div>`;
        }
        if (contact.email && !isShareMode) {
            detailsHTML += `<div class="contact-detail"><span>✉️</span> ${contact.email}</div>`;
        }

        const infoHTML = `
            <div class="contact-info">
                <div class="contact-name">${escapeHtml(contact.name)}</div>
                <div class="contact-details">${detailsHTML}</div>
                ${contact.notes ? `<div class="contact-notes">${escapeHtml(contact.notes)}</div>` : ''}
            </div>
        `;

        card.innerHTML = infoHTML;

        if (!isShareMode) {
            const actionsHTML = `
                <div class="contact-actions">
                    <button class="btn btn-icon edit-btn" data-id="${contact.id}">✏️ Edit</button>
                    <button class="btn btn-icon btn-delete delete-btn" data-id="${contact.id}">🗑️ Delete</button>
                </div>
            `;
            card.innerHTML += actionsHTML;

            card.querySelector('.edit-btn').addEventListener('click', () => this.showFormView(contact.id));
            card.querySelector('.delete-btn').addEventListener('click', () => this.showDeleteConfirm(contact.id, contact.name));
        } else {
            const sharedText = this.sharedData?.text || this.sharedData?.url || '';
            const shareActions = document.createElement('div');
            shareActions.className = 'share-actions';

            if (contact.phone) {
                const smsLink = document.createElement('a');
                smsLink.className = 'btn btn-primary share-action-link';
                smsLink.href = `sms:${contact.phone}?body=${encodeURIComponent(sharedText)}`;
                smsLink.textContent = 'Text';
                shareActions.appendChild(smsLink);
            }

            if (contact.email) {
                const emailLink = document.createElement('a');
                emailLink.className = 'btn btn-secondary share-action-link';
                emailLink.href = `mailto:${contact.email}?subject=Check this out&body=${encodeURIComponent(sharedText)}`;
                emailLink.textContent = 'Email';
                shareActions.appendChild(emailLink);
            }

            if (shareActions.childElementCount > 0) {
                card.appendChild(shareActions);
            }
        }

        return card;
    }

    clearForm() {
        this.contactForm.reset();
        this.currentEditId = null;
    }

    handleFormSubmit(e) {
        e.preventDefault();

        const contact = {
            name: this.nameInput.value.trim(),
            phone: this.phoneInput.value.trim(),
            email: this.emailInput.value.trim(),
            birthday: this.birthdayInput.value,
            notes: this.notesInput.value.trim()
        };

        if (!contact.name) {
            alert('Please enter a contact name.');
            return;
        }

        if (this.currentEditId) {
            this.contactManager.updateContact(this.currentEditId, contact);
        } else {
            this.contactManager.addContact(contact);
        }

        this.showContactsView();
    }

    showDeleteConfirm(contactId, contactName) {
        this.confirmTitle.textContent = 'Delete Contact';
        this.confirmMessage.textContent = `Are you sure you want to permanently delete "${contactName}"? This action cannot be undone.`;
        this.confirmYes.dataset.contactId = contactId;
        this.openModal();
    }

    confirmDelete() {
        const contactId = this.confirmYes.dataset.contactId;
        if (this.contactManager.deleteContact(contactId)) {
            this.closeModal();
            this.render();
        }
    }

    handleImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            let imported = 0;

            if (file.name.endsWith('.csv')) {
                imported = this.contactManager.importCSV(content);
            } else if (file.name.endsWith('.vcf')) {
                imported = this.contactManager.importVCard(content);
            }

            alert(`Imported ${imported} contact${imported !== 1 ? 's' : ''}.`);
            this.render();
        };
        reader.readAsText(file);
        this.importFile.value = '';
    }

    openModal() {
        this.confirmDialog.classList.remove('hidden');
        this.modalOverlay.classList.remove('hidden');
    }

    closeModal() {
        this.confirmDialog.classList.add('hidden');
        this.modalOverlay.classList.add('hidden');
    }

    checkForSharedData() {
        const params = new URLSearchParams(window.location.search);
        const sharedText = params.get('text');
        const sharedUrl = params.get('url');
        const sharedTitle = params.get('title');

        if (sharedText || sharedUrl) {
            this.showShareView({
                text: sharedText,
                url: sharedUrl,
                title: sharedTitle,
                type: 'shared'
            });
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize App
let contactManager;
let securityManager;
let uiManager;

document.addEventListener('DOMContentLoaded', () => {
    contactManager = new ContactManager();
    securityManager = new SecurityManager();
    uiManager = new UIManager(contactManager, securityManager);
});
