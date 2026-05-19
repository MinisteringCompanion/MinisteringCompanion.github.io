// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
        console.log('Service Worker registration failed:', err);
    });
}

// Show a demo video inside the Share feature card when Web Share is available,
// otherwise remove the share feature card entirely.
(function handleShareFeatureAndVideo() {
    const shareSupported = ('share' in navigator) || ('canShare' in navigator);
    const videoId = 'twrWuNYKTTI';
    try {
        const card = document.getElementById('shareFeatureCard');
        const videoContainer = document.getElementById('shareVideoContainer');
        const iframe = document.getElementById('shareVideoIframe');

        if (!shareSupported) {
            if (card && card.parentElement) {
                card.parentElement.removeChild(card);
                return;
            }
            const el = document.getElementById('shareFeatureText');
            if (el && el.parentElement) el.parentElement.removeChild(el);
            return;
        }

        // Sharing is supported: populate and show the video if present.
        if (iframe && videoContainer) {
            // Use the standard embed URL for YouTube
            iframe.src = `https://www.youtube.com/embed/${videoId}`;
            videoContainer.style.display = 'block';
        } else if (card) {
            // Fallback: create container and iframe dynamically
            const div = document.createElement('div');
            div.id = 'shareVideoContainer';
            div.style.marginTop = '10px';
            const f = document.createElement('iframe');
            f.id = 'shareVideoIframe';
            f.width = '320';
            f.height = '180';
            f.frameBorder = '0';
            f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
            f.allowFullscreen = true;
            f.src = `https://www.youtube.com/embed/${videoId}`;
            div.appendChild(f);
            card.appendChild(div);
        }
    } catch (e) {
        // ignore failures silently
    }
})();

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
        if (this.contacts.length >= 10) {
            return null;
        }

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

        for (let index = 0; index < lines.length; index++) {
            if (index === 0) continue; // Skip header
            if (this.contacts.length >= 10) break;
            const parts = lines[index].split(',').map(p => p.trim());
            if (parts.length > 0 && parts[0]) {
                const contact = {
                    name: parts[0] || '',
                    phone: parts[1] || '',
                    email: parts[2] || '',
                    birthday: parts[3] || '',
                    notes: '',
                    textable: false
                };
                const added = this.addContact(contact);
                if (added) imported++;
            }
        }

        return imported;
    }

    importVCard(vcardText) {
        let imported = 0;
        const vCards = vcardText.split('END:VCARD');

        for (let i = 0; i < vCards.length; i++) {
            if (this.contacts.length >= 10) break;
            const vcard = vCards[i];
            if (!vcard.includes('BEGIN:VCARD')) continue;

            const contact = {
                name: this.extractVCardField(vcard, 'FN') || '',
                phone: this.extractVCardField(vcard, 'TEL') || '',
                email: this.extractVCardField(vcard, 'EMAIL') || '',
                birthday: this.extractVCardField(vcard, 'BDAY') || '',
                notes: '',
                textable: false
            };

            if (contact.name) {
                const added = this.addContact(contact);
                if (added) imported++;
            }
        }

        return imported;
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
        this.birthdayPromptPromiseResolver = null;
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
        this.contactCount = document.getElementById('contactCount');

        // Form
        this.contactForm = document.getElementById('contactForm');
        this.formTitle = document.getElementById('formTitle');
        this.nameInput = document.getElementById('name');
        this.phoneInput = document.getElementById('phone');
        this.emailInput = document.getElementById('email');
        this.birthdayMonthInput = document.getElementById('birthdayMonth');
        this.birthdayDayInput = document.getElementById('birthdayDay');
        this.birthdayYearInput = document.getElementById('birthdayYear');
        this.notesInput = document.getElementById('notes');
        this.birthdayPromptDialog = document.getElementById('birthdayPromptDialog');
        this.birthdayPromptTitle = document.getElementById('birthdayPromptTitle');
        this.birthdayPromptMessage = document.getElementById('birthdayPromptMessage');
        this.birthdayPromptMonthInput = document.getElementById('birthdayPromptMonth');
        this.birthdayPromptDayInput = document.getElementById('birthdayPromptDay');
        this.birthdayPromptYearInput = document.getElementById('birthdayPromptYear');
        this.birthdayPromptHint = document.getElementById('birthdayPromptHint');
        this.birthdayPromptSave = document.getElementById('birthdayPromptSave');
        this.birthdayPromptCancel = document.getElementById('birthdayPromptCancel');

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
        this.textableInput = document.getElementById('textable');
        this.securityHint = document.getElementById('securityHint');
        this.securityCancel = document.getElementById('securityCancel');
        this.securityBiometricBtn = document.getElementById('securityBiometricBtn');
        this.securitySubmit = document.getElementById('securitySubmit');
        // Message preview elements
        this.messagePreviewDialog = document.getElementById('messagePreviewDialog');
        this.previewTitle = document.getElementById('previewTitle');
        this.previewSubject = document.getElementById('previewSubject');
        this.previewSubjectLabel = document.getElementById('previewSubjectLabel');
        this.previewBody = document.getElementById('previewBody');
        this.previewCancel = document.getElementById('previewCancel');
        this.previewSend = document.getElementById('previewSend');
    }

    attachEventListeners() {
        this.addContactBtn.addEventListener('click', () => this.handleAddContact());
        this.importBtn.addEventListener('click', (e) => {
            if (this.importBtn.disabled) return;
            this.importFile.click();
        });
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
        if (this.birthdayPromptSave) this.birthdayPromptSave.addEventListener('click', () => this.handleBirthdayPromptSave());
        if (this.birthdayPromptCancel) this.birthdayPromptCancel.addEventListener('click', () => this.closeBirthdayPrompt());
        // nothing extra to attach for textable; it's handled in the form save
        this.modalOverlay.addEventListener('click', () => this.handleOverlayClick());

        // Preview dialog actions
        if (this.previewCancel) this.previewCancel.addEventListener('click', () => this.closeMessagePreview());
        if (this.previewSend) this.previewSend.addEventListener('click', () => this.sendPreviewMessage());

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

        if (this.birthdayPromptDialog && !this.birthdayPromptDialog.classList.contains('hidden')) {
            this.closeBirthdayPrompt();
            return;
        }

        // Close message preview if open
        if (this.messagePreviewDialog && !this.messagePreviewDialog.classList.contains('hidden')) {
            this.closeMessagePreview();
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
                this.notesInput.value = contact.notes || '';
                if (this.textableInput) this.textableInput.checked = contact.textable === true;
                this.setBirthdayFields(contact.birthday || '');
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
            const remainingSlots = 10 - this.contactManager.getAllContacts().length;
            if (remainingSlots <= 0) {
                alert('Maximum of 10 contacts allowed. Delete an existing contact to add another.');
                return;
            }

            try {
                const selectedContacts = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });

                if (selectedContacts && selectedContacts.length > 0) {
                    const contactsToProcess = selectedContacts.slice(0, remainingSlots);
                    let addedCount = 0;

                    for (const selectedContact of contactsToProcess) {
                        if (this.contactManager.getAllContacts().length >= 10) {
                            break;
                        }

                        const names = selectedContact.name || [];
                        const phones = selectedContact.tel || [];
                        const emails = selectedContact.email || [];
                        const pickerBirthday = this.extractBirthdayFromSelectedContact(selectedContact);
                        const birthdayValue = pickerBirthday || await this.promptForBirthday(names[0] || 'this contact');
                        const contact = {
                            name: names[0] || 'Unnamed Contact',
                            phone: phones[0] || '',
                            email: emails[0] || '',
                            birthday: birthdayValue,
                            notes: '',
                            textable: false
                        };

                        const added = this.contactManager.addContact(contact);
                        if (added) {
                            addedCount += 1;
                        }
                    }

                    if (addedCount > 0) {
                        this.render();
                        if (selectedContacts.length > contactsToProcess.length || addedCount < contactsToProcess.length) {
                            alert(`Added ${addedCount} contact(s). Reached maximum of 10 contacts.`);
                        }
                        return;
                    }

                    alert('Unable to add contacts. Maximum of 10 contacts allowed.');
                }
            } catch (error) {
                console.log('Contacts picker unavailable or cancelled:', error);
            }
        }

        // Prevent opening the add form if at capacity
        if (this.contactManager.getAllContacts().length >= 10) {
            alert('Maximum of 10 contacts allowed. Delete an existing contact to add another.');
            return;
        }

        this.showFormView();
    }

    extractBirthdayFromSelectedContact(selectedContact) {
        if (!selectedContact || selectedContact.birthday == null) {
            return '';
        }

        const rawBirthday = selectedContact.birthday;

        if (Array.isArray(rawBirthday)) {
            return this.normalizeBirthdayInput(rawBirthday[0]);
        }

        if (typeof rawBirthday === 'string') {
            return this.normalizeBirthdayInput(rawBirthday);
        }

        if (typeof rawBirthday === 'object') {
            const year = rawBirthday.year ?? rawBirthday.y;
            const month = rawBirthday.month ?? rawBirthday.m;
            const day = rawBirthday.day ?? rawBirthday.d;

            if (year && month && day) {
                return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
        }

        return '';
    }

    normalizeBirthdayInput(value) {
        if (!value) {
            return '';
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return '';
        }

        const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
            return trimmed;
        }

        const monthDayMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})$/);
        if (monthDayMatch) {
            const month = monthDayMatch[1].padStart(2, '0');
            const day = monthDayMatch[2].padStart(2, '0');
            return `${month}-${day}`;
        }

        const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (slashMatch) {
            const month = slashMatch[1].padStart(2, '0');
            const day = slashMatch[2].padStart(2, '0');
            return `${slashMatch[3]}-${month}-${day}`;
        }

        const monthDaySlashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (monthDaySlashMatch) {
            const month = monthDaySlashMatch[1].padStart(2, '0');
            const day = monthDaySlashMatch[2].padStart(2, '0');
            return `${month}-${day}`;
        }

        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) {
            const year = parsed.getFullYear();
            const month = String(parsed.getMonth() + 1).padStart(2, '0');
            const day = String(parsed.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        return '';
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

    // Return true if birthdayValue occurs within `withinDays` days from today (0 = today)
    isBirthdayWithin(birthdayValue, withinDays = 2) {
        if (!birthdayValue) return false;
        const normalized = this.normalizeBirthdayInput(birthdayValue);
        if (!normalized) return false;

        const parts = normalized.split('-');
        let month, day;
        if (parts.length === 3) {
            month = parseInt(parts[1], 10);
            day = parseInt(parts[2], 10);
        } else if (parts.length === 2) {
            month = parseInt(parts[0], 10);
            day = parseInt(parts[1], 10);
        } else {
            return false;
        }

        const today = new Date();
        const year = today.getFullYear();

        // Handle Feb 29 on non-leap years by treating as Feb 28
        if (month === 2 && day === 29 && !this.isLeapYear(String(year))) {
            day = 28;
        }

        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        // Calculate most recent birthday (this year or last year)
        let recentBirthday = new Date(year, month - 1, day);
        // If this year's birthday hasn't occurred yet, use last year's
        if (recentBirthday > startOfToday) {
            recentBirthday = new Date(year - 1, month - 1, day);
        }

        // Calculate days elapsed since the birthday
        const diffMs = startOfToday - recentBirthday;
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= withinDays;
    }

    getDaysSinceBirthday(birthdayValue) {
        if (!birthdayValue) return null;
        const normalized = this.normalizeBirthdayInput(birthdayValue);
        if (!normalized) return null;

        const parts = normalized.split('-');
        let month, day;
        if (parts.length === 3) {
            month = parseInt(parts[1], 10);
            day = parseInt(parts[2], 10);
        } else if (parts.length === 2) {
            month = parseInt(parts[0], 10);
            day = parseInt(parts[1], 10);
        } else {
            return null;
        }

        const today = new Date();
        const year = today.getFullYear();

        // Handle Feb 29 on non-leap years by treating as Feb 28
        if (month === 2 && day === 29 && !this.isLeapYear(String(year))) {
            day = 28;
        }

        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        // Calculate most recent birthday (this year or last year)
        let recentBirthday = new Date(year, month - 1, day);
        // If this year's birthday hasn't occurred yet, use last year's
        if (recentBirthday > startOfToday) {
            recentBirthday = new Date(year - 1, month - 1, day);
        }

        // Calculate days elapsed since the birthday
        const diffMs = startOfToday - recentBirthday;
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return diffDays;
    }

    render() {
        const contacts = this.contactManager.getAllContacts();

        const total = contacts.length;
        if (this.contactCount) {
            this.contactCount.textContent = `${total}/10 contacts`;
        }
        if (this.addContactBtn) {
            this.addContactBtn.disabled = total >= 10;
        }
        if (this.importBtn) {
            this.importBtn.disabled = total >= 10;
        }
        if (this.importFile) {
            this.importFile.disabled = total >= 10;
        }

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
            const isTextable = contact.textable === true;
            const phoneHref = isTextable ? `sms:${contact.phone}` : `tel:${contact.phone}`;
            const phoneClass = isTextable ? 'contact-link phone-link textable' : 'contact-link phone-link';
            const phoneLink = `<a href="${phoneHref}" class="${phoneClass}">${escapeHtml(contact.phone)}</a>`;
            const badge = isTextable ? `<span class="textable-indicator" title="Can receive SMS">💬 Textable</span>` : '';
            detailsHTML += `<div class="contact-detail"><span>📱</span> ${phoneLink} ${badge}</div>`;
        }

        // Show quick birthday action when birthday was today or up to 2 days ago (so you can send a late birthday wish)
        const showBirthdayAction = this.isBirthdayWithin(contact.birthday, 2);
        if (showBirthdayAction) {
            const firstName = contact.name ? String(contact.name).trim().split(/\s+/)[0] : '';
            const birthdayText = firstName
                ? `Happy Birthday ${firstName}! Wishing you a wonderful day.`
                : 'Happy Birthday! Wishing you a wonderful day.';
            let actionHTML = '';
            if (contact.phone && contact.textable === true) {
                actionHTML = `<a class="btn birthday-btn" href="#" data-method="sms" data-id="${contact.id}" title="Send birthday text">🎉</a>`;
            } else if (contact.email) {
                actionHTML = `<a class="btn birthday-btn" href="#" data-method="email" data-id="${contact.id}" title="Send birthday email">🎉</a>`;
            }

            if (actionHTML) {
                detailsHTML += `<div class="contact-detail">${actionHTML}</div>`;
            }
        }
        if (contact.birthday) {
            const formattedBday = this.formatBirthdayForDisplay(contact.birthday);
            detailsHTML += `<div class="contact-detail"><span>🎂</span> ${formattedBday}</div>`;
        }
        if (contact.email) {
            const emailLink = `<a href="mailto:${escapeHtml(contact.email)}" class="contact-link email-link">${escapeHtml(contact.email)}</a>`;
            detailsHTML += `<div class="contact-detail"><span>✉️</span> ${emailLink}</div>`;
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
            const bbtn = card.querySelector('.birthday-btn');
            if (bbtn) {
                bbtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const method = bbtn.dataset.method;
                    const cid = bbtn.dataset.id;
                    const c = this.contactManager.getContact(cid);
                    if (c) this.openMessagePreview(c, method);
                });
            }
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
        this.birthdayMonthInput.value = '';
        this.birthdayDayInput.value = '';
        this.birthdayYearInput.value = '';
        this.currentEditId = null;
        if (this.textableInput) this.textableInput.checked = false;
    }

    setBirthdayFields(birthdayValue) {
        this.birthdayMonthInput.value = '';
        this.birthdayDayInput.value = '';
        this.birthdayYearInput.value = '';

        if (!birthdayValue) {
            return;
        }

        const normalized = this.normalizeBirthdayInput(birthdayValue);
        if (!normalized) {
            return;
        }

        const parts = normalized.split('-');
        if (parts.length === 3) {
            this.birthdayYearInput.value = parts[0];
            this.birthdayMonthInput.value = parts[1];
            this.birthdayDayInput.value = String(parseInt(parts[2], 10));
            return;
        }

        if (parts.length === 2) {
            this.birthdayMonthInput.value = parts[0];
            this.birthdayDayInput.value = String(parseInt(parts[1], 10));
        }
    }

    getBirthdayValue() {
        return this.getBirthdaySelectionValue(
            this.birthdayMonthInput.value,
            this.birthdayDayInput.value,
            this.birthdayYearInput.value
        );
    }

    validateBirthdayFields() {
        return this.validateBirthdaySelection(
            this.birthdayMonthInput.value,
            this.birthdayDayInput.value,
            this.birthdayYearInput.value
        );
    }

    validateBirthdaySelection(monthValue, dayValue, yearValue) {
        const month = parseInt(monthValue, 10);
        const day = parseInt(dayValue, 10);
        const trimmedYear = yearValue.trim();

        if (!month && !day && !trimmedYear) {
            return '';
        }

        if (!month || !day) {
            return 'Please choose both a month and a day for the birthday.';
        }

        const maxDayByMonth = [31, this.isLeapYear(trimmedYear) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const maxDay = maxDayByMonth[month - 1];

        if (!maxDay) {
            return 'Please choose a valid birthday month.';
        }

        if (day < 1 || day > maxDay) {
            const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1];
            return `${monthName} does not have ${day} days.`;
        }

        if (trimmedYear) {
            const year = parseInt(trimmedYear, 10);
            if (Number.isNaN(year) || trimmedYear.length !== 4) {
                return 'Please enter a four-digit year, or leave the year blank.';
            }
        }

        return '';
    }

    getBirthdaySelectionValue(monthValue, dayValue, yearValue) {
        const month = monthValue;
        const day = dayValue;
        const year = yearValue.trim();

        if (!month || !day) {
            return '';
        }

        const monthValuePadded = month.padStart(2, '0');
        const dayValuePadded = String(parseInt(day, 10)).padStart(2, '0');
        return year ? `${year}-${monthValuePadded}-${dayValuePadded}` : `${monthValuePadded}-${dayValuePadded}`;
    }

    setBirthdayPromptFields(birthdayValue) {
        if (this.birthdayPromptMonthInput) this.birthdayPromptMonthInput.value = '';
        if (this.birthdayPromptDayInput) this.birthdayPromptDayInput.value = '';
        if (this.birthdayPromptYearInput) this.birthdayPromptYearInput.value = '';

        if (!birthdayValue) {
            return;
        }

        const normalized = this.normalizeBirthdayInput(birthdayValue);
        if (!normalized) {
            return;
        }

        const parts = normalized.split('-');
        if (parts.length === 3) {
            if (this.birthdayPromptYearInput) this.birthdayPromptYearInput.value = parts[0];
            if (this.birthdayPromptMonthInput) this.birthdayPromptMonthInput.value = parts[1];
            if (this.birthdayPromptDayInput) this.birthdayPromptDayInput.value = String(parseInt(parts[2], 10));
            return;
        }

        if (parts.length === 2) {
            if (this.birthdayPromptMonthInput) this.birthdayPromptMonthInput.value = parts[0];
            if (this.birthdayPromptDayInput) this.birthdayPromptDayInput.value = String(parseInt(parts[1], 10));
        }
    }

    promptForBirthday(contactName, existingBirthday = '') {
        if (!this.birthdayPromptDialog || !this.birthdayPromptMonthInput || !this.birthdayPromptDayInput || !this.birthdayPromptYearInput) {
            return Promise.resolve(existingBirthday || '');
        }

        if (this.birthdayPromptPromiseResolver) {
            this.birthdayPromptPromiseResolver(existingBirthday || '');
            this.birthdayPromptPromiseResolver = null;
        }

        if (this.birthdayPromptTitle) {
            this.birthdayPromptTitle.textContent = `Birthday for ${contactName}`;
        }
        if (this.birthdayPromptMessage) {
            this.birthdayPromptMessage.textContent = 'Use the birthday picker below, or click Skip if you do not know the birthday yet.';
        }
        if (this.birthdayPromptHint) {
            this.birthdayPromptHint.textContent = '';
            this.birthdayPromptHint.classList.remove('error');
        }

        this.setBirthdayPromptFields(existingBirthday);
        this.birthdayPromptDialog.classList.remove('hidden');
        this.modalOverlay.classList.remove('hidden');
        this.birthdayPromptMonthInput.focus();

        return new Promise(resolve => {
            this.birthdayPromptPromiseResolver = resolve;
        });
    }

    handleBirthdayPromptSave() {
        if (!this.birthdayPromptPromiseResolver) {
            this.closeBirthdayPrompt();
            return;
        }

        if (!this.birthdayPromptMonthInput.value && !this.birthdayPromptDayInput.value && !this.birthdayPromptYearInput.value.trim()) {
            if (this.birthdayPromptHint) {
                this.birthdayPromptHint.textContent = 'Please choose a birthday or click Skip.';
                this.birthdayPromptHint.classList.add('error');
            }
            return;
        }

        const validation = this.validateBirthdaySelection(
            this.birthdayPromptMonthInput.value,
            this.birthdayPromptDayInput.value,
            this.birthdayPromptYearInput.value
        );

        if (validation) {
            if (this.birthdayPromptHint) {
                this.birthdayPromptHint.textContent = validation;
                this.birthdayPromptHint.classList.add('error');
            }
            return;
        }

        const birthdayValue = this.getBirthdaySelectionValue(
            this.birthdayPromptMonthInput.value,
            this.birthdayPromptDayInput.value,
            this.birthdayPromptYearInput.value
        );

        this.closeBirthdayPrompt(birthdayValue);
    }

    closeBirthdayPrompt(birthdayValue = '') {
        if (this.birthdayPromptDialog) {
            this.birthdayPromptDialog.classList.add('hidden');
        }
        this.modalOverlay.classList.add('hidden');

        if (this.birthdayPromptHint) {
            this.birthdayPromptHint.textContent = '';
            this.birthdayPromptHint.classList.remove('error');
        }

        if (this.birthdayPromptPromiseResolver) {
            const resolve = this.birthdayPromptPromiseResolver;
            this.birthdayPromptPromiseResolver = null;
            resolve(birthdayValue || '');
        }
    }

    isLeapYear(yearValue) {
        if (!yearValue) {
            return true;
        }

        const year = parseInt(yearValue, 10);
        if (Number.isNaN(year)) {
            return false;
        }

        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    }

    formatBirthdayForDisplay(birthdayValue) {
        const normalized = this.normalizeBirthdayInput(birthdayValue);
        if (!normalized) {
            return '';
        }

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const parts = normalized.split('-');
        let month = '';
        let day = '';

        if (parts.length === 3) {
            month = parts[1];
            day = parts[2];
        } else if (parts.length === 2) {
            month = parts[0];
            day = parts[1];
        }

        const monthIndex = parseInt(month, 10) - 1;
        const monthName = months[monthIndex] || '';
        return `${monthName} ${parseInt(day, 10)}`.trim();
    }

    handleFormSubmit(e) {
        e.preventDefault();

        const birthdayValidation = this.validateBirthdayFields();
        if (birthdayValidation) {
            alert(birthdayValidation);
            return;
        }

        const contact = {
            name: this.nameInput.value.trim(),
            phone: this.phoneInput.value.trim(),
            email: this.emailInput.value.trim(),
            birthday: this.getBirthdayValue(),
            notes: this.notesInput.value.trim(),
            textable: this.textableInput ? Boolean(this.textableInput.checked) : false
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
                const lines = content.trim().split('\n');
                const expected = Math.max(0, lines.length - 1);
                imported = this.contactManager.importCSV(content);
                if (imported < expected && this.contactManager.getAllContacts().length >= 10) {
                    alert(`Imported ${imported} contact(s). Reached maximum of 10 contacts; ${expected - imported} were not imported.`);
                } else {
                    alert(`Imported ${imported} contact(s).`);
                }
            } else if (file.name.endsWith('.vcf')) {
                const expected = (content.match(/BEGIN:VCARD/gi) || []).length;
                imported = this.contactManager.importVCard(content);
                if (imported < expected && this.contactManager.getAllContacts().length >= 10) {
                    alert(`Imported ${imported} contact(s). Reached maximum of 10 contacts; ${expected - imported} were not imported.`);
                } else {
                    alert(`Imported ${imported} contact(s).`);
                }
            }

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

    openMessagePreview(contact, method) {
        this.currentPreviewContact = contact;
        this.currentPreviewMethod = method; // 'sms' or 'email'

        const firstName = contact.name ? String(contact.name).trim().split(/\s+/)[0] : '';

        // Determine if today is the birthday or if it's belated
        const daysSince = this.getDaysSinceBirthday(contact.birthday);
        const greeting = daysSince === 0
            ? 'Happy birthday'
            : 'Happy belated birthday';

        const birthdayText = firstName
            ? `${greeting} ${firstName}! Wishing you a wonderful day.`
            : `${greeting}! Wishing you a wonderful day.`;

        if (method === 'email') {
            this.previewSubject.value = greeting + '!';
            this.previewSubject.classList.remove('hidden');
            this.previewSubjectLabel.classList.remove('hidden');
        } else {
            this.previewSubject.value = '';
            this.previewSubject.classList.add('hidden');
            this.previewSubjectLabel.classList.add('hidden');
        }

        this.previewBody.value = birthdayText;
        this.previewBody.focus();
        this.messagePreviewDialog.classList.remove('hidden');
        this.modalOverlay.classList.remove('hidden');
    }

    closeMessagePreview() {
        this.messagePreviewDialog.classList.add('hidden');
        this.modalOverlay.classList.add('hidden');
        this.currentPreviewContact = null;
        this.currentPreviewMethod = null;
    }

    sendPreviewMessage() {
        if (!this.currentPreviewContact || !this.currentPreviewMethod) return;
        const body = this.previewBody.value || '';
        if (this.currentPreviewMethod === 'sms') {
            const href = `sms:${this.currentPreviewContact.phone}?body=${encodeURIComponent(body)}`;
            window.location.href = href;
        } else if (this.currentPreviewMethod === 'email') {
            const subject = this.previewSubject.value || 'Happy Birthday!';
            const href = `mailto:${this.currentPreviewContact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.location.href = href;
        }

        this.closeMessagePreview();
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

    // First-time modal setup
    initializeFirstTimeModal();
});

function initializeFirstTimeModal() {
    const FIRST_TIME_USER_KEY = 'ministering_app_first_time_user';
    const firstTimeModal = document.getElementById('firstTimeModal');
    const closeFirstTimeModalBtn = document.getElementById('closeFirstTimeModal');
    const getStartedBtn = document.getElementById('getStartedBtn');
    const floatingHelpBtn = document.getElementById('floatingHelpBtn');
    const modalOverlay = document.getElementById('modalOverlay');

    // Check if this is the first time user
    const isFirstTimeUser = !localStorage.getItem(FIRST_TIME_USER_KEY);

    // Function to show the modal
    function showFirstTimeModal() {
        firstTimeModal.classList.remove('hidden');
        modalOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    // Function to close the modal
    function closeFirstTimeModal() {
        firstTimeModal.classList.add('hidden');
        modalOverlay.classList.add('hidden');
        document.body.style.overflow = '';

        // Mark user as no longer a first-time user
        localStorage.setItem(FIRST_TIME_USER_KEY, 'true');
    }

    // Show modal on first visit
    if (isFirstTimeUser) {
        showFirstTimeModal();
    }

    // Close button event listener
    closeFirstTimeModalBtn.addEventListener('click', closeFirstTimeModal);

    // Get Started button event listener
    getStartedBtn.addEventListener('click', closeFirstTimeModal);

    // Floating help button event listener
    floatingHelpBtn.addEventListener('click', () => {
        showFirstTimeModal();
    });

    // Modal overlay click to close
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeFirstTimeModal();
        }
    });
}
