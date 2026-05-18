// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
        console.log('Service Worker registration failed:', err);
    });
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

function bytesToBase64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function generateRandomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

function concatenateUint8Arrays(...arrays) {
    const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    arrays.forEach(array => {
        result.set(array, offset);
        offset += array.length;
    });

    return result;
}

function normalizeBuffer(input) {
    if (input instanceof Uint8Array) {
        return input;
    }

    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
    }

    return new Uint8Array(input.buffer || input);
}

function cborDecode(buffer) {
    const bytes = normalizeBuffer(buffer);
    const state = { offset: 0 };

    function readLength(additionalInfo) {
        if (additionalInfo < 24) {
            return additionalInfo;
        }

        if (additionalInfo === 24) {
            return bytes[state.offset++];
        }

        if (additionalInfo === 25) {
            const value = (bytes[state.offset] << 8) | bytes[state.offset + 1];
            state.offset += 2;
            return value;
        }

        if (additionalInfo === 26) {
            const view = new DataView(bytes.buffer, bytes.byteOffset + state.offset, 4);
            const value = view.getUint32(0, false);
            state.offset += 4;
            return value;
        }

        throw new Error('Unsupported CBOR length encoding.');
    }

    function decodeItem() {
        const initialByte = bytes[state.offset++];
        const majorType = initialByte >> 5;
        const additionalInfo = initialByte & 0x1f;

        switch (majorType) {
            case 0:
                return readLength(additionalInfo);
            case 1:
                return -1 - readLength(additionalInfo);
            case 2: {
                const length = readLength(additionalInfo);
                const value = bytes.slice(state.offset, state.offset + length);
                state.offset += length;
                return value;
            }
            case 3: {
                const length = readLength(additionalInfo);
                const value = bytes.slice(state.offset, state.offset + length);
                state.offset += length;
                return new TextDecoder().decode(value);
            }
            case 4: {
                const length = readLength(additionalInfo);
                const array = [];

                for (let index = 0; index < length; index++) {
                    array.push(decodeItem());
                }

                return array;
            }
            case 5: {
                const length = readLength(additionalInfo);
                const map = {};

                for (let index = 0; index < length; index++) {
                    const key = decodeItem();
                    map[key] = decodeItem();
                }

                return map;
            }
            case 7:
                if (additionalInfo === 20) return false;
                if (additionalInfo === 21) return true;
                if (additionalInfo === 22 || additionalInfo === 23) return null;
                break;
            default:
                break;
        }

        throw new Error('Unsupported CBOR value.');
    }

    return decodeItem();
}

async function digestBytes(bytes) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(hash);
}

async function hashPin(pin, saltBytes) {
    const pinBytes = new TextEncoder().encode(pin);
    const payload = concatenateUint8Arrays(saltBytes, pinBytes);
    return bytesToBase64Url(await digestBytes(payload));
}

function parseBiometricCredential(attestationObject) {
    const attestation = cborDecode(attestationObject);
    const authData = normalizeBuffer(attestation.authData);
    const flags = authData[32];

    if ((flags & 0x40) === 0) {
        throw new Error('Biometric registration did not include credential data.');
    }

    let offset = 37;
    offset += 16;

    const credentialIdLength = (authData[offset] << 8) | authData[offset + 1];
    offset += 2;

    const credentialId = authData.slice(offset, offset + credentialIdLength);
    offset += credentialIdLength;

    const credentialPublicKey = cborDecode(authData.slice(offset));

    return {
        credentialId,
        credentialPublicKey
    };
}

function coseKeyToJwk(coseKey) {
    const keyType = coseKey[1];
    const algorithm = coseKey[3];
    const curve = coseKey[-1];
    const xCoordinate = coseKey[-2];
    const yCoordinate = coseKey[-3];

    if (keyType !== 2 || algorithm !== -7 || curve !== 1) {
        throw new Error('Unsupported biometric credential type.');
    }

    return {
        kty: 'EC',
        crv: 'P-256',
        x: bytesToBase64Url(normalizeBuffer(xCoordinate)),
        y: bytesToBase64Url(normalizeBuffer(yCoordinate)),
        ext: true
    };
}

class SecurityManager {
    constructor() {
        this.SETTINGS_KEY = 'ministering_security_v1';
        this.SESSION_KEY = 'ministering_unlocked_session_v1';
        this.settings = this.loadSettings();
    }

    loadSettings() {
        try {
            const rawSettings = localStorage.getItem(this.SETTINGS_KEY);
            return rawSettings ? JSON.parse(rawSettings) : {};
        } catch (error) {
            console.error('Error loading security settings:', error);
            return {};
        }
    }

    saveSettings() {
        localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(this.settings));
    }

    hasPin() {
        return Boolean(this.settings.pinHash && this.settings.pinSalt);
    }

    isBiometricEnabled() {
        return Boolean(this.settings.biometric && this.settings.biometric.enabled && this.settings.biometric.credentialId && this.settings.biometric.publicKey);
    }

    isUnlocked() {
        return sessionStorage.getItem(this.SESSION_KEY) === 'true';
    }

    lock() {
        sessionStorage.removeItem(this.SESSION_KEY);
    }

    unlock() {
        sessionStorage.setItem(this.SESSION_KEY, 'true');
    }

    getPromptMessage() {
        return this.hasPin() ? 'Enter your app PIN to continue.' : 'Use biometrics if available, or ask the owner to set a PIN first.';
    }

    async verifyPin(pin) {
        if (!this.hasPin()) {
            return false;
        }

        const saltBytes = base64UrlToBytes(this.settings.pinSalt);
        const pinHash = await hashPin(pin, saltBytes);
        return pinHash === this.settings.pinHash;
    }

    async setPin(currentPin, newPin) {
        if (this.hasPin() && !(await this.verifyPin(currentPin))) {
            throw new Error('Current PIN is incorrect.');
        }

        const saltBytes = generateRandomBytes(16);
        this.settings.pinSalt = bytesToBase64Url(saltBytes);
        this.settings.pinHash = await hashPin(newPin, saltBytes);
        this.saveSettings();
    }

    async removePin(currentPin) {
        if (this.hasPin() && !(await this.verifyPin(currentPin))) {
            throw new Error('Current PIN is incorrect.');
        }

        delete this.settings.pinSalt;
        delete this.settings.pinHash;
        this.saveSettings();
    }

    setBiometricEnabled(enabled) {
        this.settings.biometric = this.settings.biometric || {};
        this.settings.biometric.enabled = enabled;
        this.saveSettings();
    }

    hasBiometricSupport() {
        return Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials && crypto.subtle && location.hostname);
    }

    async enrollBiometric() {
        if (!this.hasBiometricSupport()) {
            throw new Error('Biometrics are not supported in this browser or context.');
        }

        const challenge = generateRandomBytes(32);
        const userId = this.settings.biometric && this.settings.biometric.userId ? base64UrlToBytes(this.settings.biometric.userId) : generateRandomBytes(16);

        const credential = await navigator.credentials.create({
            publicKey: {
                challenge,
                rp: { name: 'Ministering Contacts' },
                user: {
                    id: userId,
                    name: 'ministering-user',
                    displayName: 'Ministering Contacts'
                },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required',
                    residentKey: 'preferred'
                },
                timeout: 60000,
                attestation: 'none'
            }
        });

        let publicKey;

        if (credential.response && typeof credential.response.getPublicKey === 'function') {
            const rawPublicKey = credential.response.getPublicKey();
            if (rawPublicKey) {
                const publicKeyBytes = normalizeBuffer(rawPublicKey);
                const coseKey = cborDecode(publicKeyBytes);
                publicKey = coseKeyToJwk(coseKey);
            }
        }

        if (!publicKey) {
            const parsedCredential = parseBiometricCredential(credential.response.attestationObject);
            publicKey = coseKeyToJwk(parsedCredential.credentialPublicKey);
        }

        this.settings.biometric = {
            enabled: true,
            credentialId: bytesToBase64Url(normalizeBuffer(credential.rawId)),
            userId: bytesToBase64Url(userId),
            publicKey
        };

        this.saveSettings();
        return true;
    }

    async authenticateBiometric() {
        if (!this.isBiometricEnabled()) {
            throw new Error('Biometric unlock is not configured.');
        }

        if (!this.hasBiometricSupport()) {
            throw new Error('Biometrics are not supported in this browser or context.');
        }

        const challenge = generateRandomBytes(32);
        const credentialId = base64UrlToBytes(this.settings.biometric.credentialId);
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge,
                allowCredentials: [{ type: 'public-key', id: credentialId }],
                userVerification: 'required',
                timeout: 60000
            }
        });

        if (!assertion || !assertion.response) {
            throw new Error('Biometric unlock was cancelled.');
        }

        const clientDataBytes = normalizeBuffer(assertion.response.clientDataJSON);
        const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));

        if (clientData.type !== 'webauthn.get') {
            throw new Error('Unexpected biometric response.');
        }

        if (clientData.origin !== window.location.origin) {
            throw new Error('Biometric response origin mismatch.');
        }

        if (clientData.challenge !== bytesToBase64Url(challenge)) {
            throw new Error('Biometric challenge mismatch.');
        }

        const publicKey = await crypto.subtle.importKey(
            'jwk',
            this.settings.biometric.publicKey,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );

        const clientDataHash = await digestBytes(clientDataBytes);
        const signedData = concatenateUint8Arrays(normalizeBuffer(assertion.response.authenticatorData), clientDataHash);
        const verified = await crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            publicKey,
            normalizeBuffer(assertion.response.signature),
            signedData
        );

        if (!verified) {
            throw new Error('Biometric verification failed.');
        }

        this.unlock();
        return true;
    }
}

// UI Manager
class UIManager {
    constructor(contactManager) {
        this.contactManager = contactManager;
        this.securityManager = new SecurityManager();
        this.currentEditId = null;
        this.sharedData = this.loadSharedDataFromUrl();
        this.pendingStartView = this.sharedData ? 'share' : 'contacts';
        this.initElements();
        this.attachEventListeners();
        this.refreshSecurityUi();
        this.applyLockState();
        if (!this.isAppLocked()) {
            this.startApp();
        }
    }

    initElements() {
        this.container = document.querySelector('.container');

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
        this.securityStatus = document.getElementById('securityStatus');
        this.currentPinInput = document.getElementById('currentPin');
        this.newPinInput = document.getElementById('newPin');
        this.confirmPinInput = document.getElementById('confirmPin');
        this.savePinBtn = document.getElementById('savePinBtn');
        this.removePinBtn = document.getElementById('removePinBtn');
        this.biometricEnabled = document.getElementById('biometricEnabled');
        this.enrollBiometricBtn = document.getElementById('enrollBiometricBtn');
        this.lockNowBtn = document.getElementById('lockNowBtn');
        this.securityCloseBtn = document.getElementById('securityCloseBtn');

        // Lock screen
        this.lockScreen = document.getElementById('lockScreen');
        this.lockMessage = document.getElementById('lockMessage');
        this.unlockPinInput = document.getElementById('unlockPin');
        this.unlockPinBtn = document.getElementById('unlockPinBtn');
        this.unlockBiometricBtn = document.getElementById('unlockBiometricBtn');
        this.lockStatus = document.getElementById('lockStatus');
    }

    attachEventListeners() {
        this.addContactBtn.addEventListener('click', () => this.handleAddContact());
        this.importBtn.addEventListener('click', () => this.importFile.click());
        this.securityBtn.addEventListener('click', () => this.openSecurityDialog());
        this.cancelBtn.addEventListener('click', () => this.showContactsView());
        this.contactForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        this.importFile.addEventListener('change', (e) => this.handleImport(e));
        this.confirmYes.addEventListener('click', () => this.confirmDelete());
        this.confirmNo.addEventListener('click', () => this.closeModal());
        this.savePinBtn.addEventListener('click', () => this.handleSavePin());
        this.removePinBtn.addEventListener('click', () => this.handleRemovePin());
        this.biometricEnabled.addEventListener('change', () => this.handleBiometricToggle());
        this.enrollBiometricBtn.addEventListener('click', () => this.handleEnrollBiometric());
        this.lockNowBtn.addEventListener('click', () => this.lockApp());
        this.securityCloseBtn.addEventListener('click', () => this.closeSecurityDialog());
        this.unlockPinBtn.addEventListener('click', () => this.handleUnlockPin());
        this.unlockBiometricBtn.addEventListener('click', () => this.handleUnlockBiometric());
        this.unlockPinInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.handleUnlockPin();
            }
        });
        this.currentPinInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.handleSavePin();
            }
        });
        this.newPinInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.handleSavePin();
            }
        });
        this.confirmPinInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.handleSavePin();
            }
        });
        this.modalOverlay.addEventListener('click', () => this.closeAllDialogs());
    }

    loadSharedDataFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const sharedText = params.get('text');
        const sharedUrl = params.get('url');
        const sharedTitle = params.get('title');

        if (sharedText || sharedUrl) {
            window.history.replaceState({}, document.title, window.location.pathname);
            return {
                text: sharedText,
                url: sharedUrl,
                title: sharedTitle,
                type: 'shared'
            };
        }

        return null;
    }

    shouldLockApp() {
        return this.securityManager.hasPin() || this.securityManager.isBiometricEnabled();
    }

    isAppLocked() {
        return this.shouldLockApp() && !this.securityManager.isUnlocked();
    }

    applyLockState() {
        const locked = this.isAppLocked();
        document.body.classList.toggle('app-locked', locked);
        this.lockScreen.classList.toggle('hidden', !locked);

        if (locked) {
            this.lockMessage.textContent = this.securityManager.getPromptMessage();
            this.unlockPinInput.value = '';
            this.lockStatus.textContent = '';
            this.refreshLockUi();
            this.unlockPinInput.focus();
        } else {
            this.lockStatus.textContent = '';
        }

        return locked;
    }

    refreshLockUi() {
        const biometricReady = this.securityManager.isBiometricEnabled();
        const biometricSupported = this.securityManager.hasBiometricSupport();
        this.unlockBiometricBtn.classList.toggle('hidden', !biometricReady);
        this.unlockBiometricBtn.disabled = !biometricSupported;
        this.unlockBiometricBtn.textContent = biometricReady ? 'Use Biometrics' : 'Biometrics Unavailable';
    }

    refreshSecurityUi() {
        this.biometricEnabled.checked = Boolean(this.securityManager.settings.biometric && this.securityManager.settings.biometric.enabled);
        this.enrollBiometricBtn.disabled = !this.securityManager.hasBiometricSupport();
        this.removePinBtn.disabled = !this.securityManager.hasPin();
        this.updateSecurityStatus();
        this.refreshLockUi();
    }

    updateSecurityStatus(message = '') {
        if (message) {
            this.securityStatus.textContent = message;
            return;
        }

        const parts = [];
        if (this.securityManager.hasPin()) {
            parts.push('PIN set');
        } else {
            parts.push('No PIN set');
        }

        if (this.securityManager.isBiometricEnabled()) {
            parts.push('biometrics enabled');
        } else if (this.securityManager.hasBiometricSupport()) {
            parts.push('biometrics available');
        } else {
            parts.push('biometrics unavailable');
        }

        this.securityStatus.textContent = parts.join(' · ');
    }

    clearSecurityForm() {
        this.currentPinInput.value = '';
        this.newPinInput.value = '';
        this.confirmPinInput.value = '';
    }

    startApp() {
        if (this.pendingStartView === 'share' && this.sharedData) {
            this.showShareView(this.sharedData);
            return;
        }

        this.showContactsView();
    }

    openSecurityDialog() {
        if (this.applyLockState()) {
            return;
        }

        this.clearSecurityForm();
        this.refreshSecurityUi();
        this.securityDialog.classList.remove('hidden');
        this.updateOverlayVisibility();
        this.currentPinInput.focus();
    }

    closeSecurityDialog() {
        this.securityDialog.classList.add('hidden');
        this.updateOverlayVisibility();
    }

    closeAllDialogs() {
        this.closeModal();
        this.closeSecurityDialog();
    }

    updateOverlayVisibility() {
        const visible = !this.confirmDialog.classList.contains('hidden') || !this.securityDialog.classList.contains('hidden');
        this.modalOverlay.classList.toggle('hidden', !visible);
    }

    lockApp() {
        this.securityManager.lock();
        this.applyLockState();
    }

    async handleUnlockPin() {
        const pin = this.unlockPinInput.value.trim();

        if (!pin) {
            this.lockStatus.textContent = 'Enter your PIN to unlock.';
            return;
        }

        if (!(await this.securityManager.verifyPin(pin))) {
            this.lockStatus.textContent = 'Incorrect PIN.';
            return;
        }

        this.securityManager.unlock();
        this.applyLockState();
        this.startApp();
    }

    async handleUnlockBiometric() {
        try {
            this.lockStatus.textContent = 'Waiting for biometric approval...';
            await this.securityManager.authenticateBiometric();
            this.applyLockState();
            this.startApp();
        } catch (error) {
            this.lockStatus.textContent = error.message;
        }
    }

    async handleSavePin() {
        const currentPin = this.currentPinInput.value.trim();
        const newPin = this.newPinInput.value.trim();
        const confirmPin = this.confirmPinInput.value.trim();

        if (!newPin) {
            this.updateSecurityStatus('Enter a new PIN.');
            return;
        }

        if (newPin.length < 4 || newPin.length > 12) {
            this.updateSecurityStatus('Use 4 to 12 digits for the PIN.');
            return;
        }

        if (!/^\d+$/.test(newPin)) {
            this.updateSecurityStatus('PINs should contain digits only.');
            return;
        }

        if (newPin !== confirmPin) {
            this.updateSecurityStatus('PIN confirmation does not match.');
            return;
        }

        try {
            await this.securityManager.setPin(currentPin, newPin);
            this.securityManager.unlock();
            this.clearSecurityForm();
            this.refreshSecurityUi();
            this.applyLockState();
            this.updateSecurityStatus('PIN saved.');
            this.startApp();
        } catch (error) {
            this.updateSecurityStatus(error.message);
        }
    }

    async handleRemovePin() {
        const currentPin = this.currentPinInput.value.trim();

        if (!currentPin && this.securityManager.hasPin()) {
            this.updateSecurityStatus('Enter the current PIN to remove it.');
            return;
        }

        try {
            await this.securityManager.removePin(currentPin);
            this.clearSecurityForm();
            this.refreshSecurityUi();
            this.applyLockState();
            this.updateSecurityStatus('PIN removed.');
        } catch (error) {
            this.updateSecurityStatus(error.message);
        }
    }

    handleBiometricToggle() {
        if (!this.securityManager.hasBiometricSupport() && this.biometricEnabled.checked) {
            this.biometricEnabled.checked = false;
            this.updateSecurityStatus('Biometrics are not supported here.');
            return;
        }

        this.securityManager.setBiometricEnabled(this.biometricEnabled.checked);
        this.refreshLockUi();
        this.updateSecurityStatus(this.biometricEnabled.checked ? 'Biometric unlock enabled. Use Set Up Biometrics to register this device.' : 'Biometric unlock disabled.');
    }

    async handleEnrollBiometric() {
        try {
            await this.securityManager.enrollBiometric();
            this.securityManager.setBiometricEnabled(true);
            this.refreshSecurityUi();
            this.updateSecurityStatus('Biometrics enrolled.');
        } catch (error) {
            this.updateSecurityStatus(error.message);
        }
    }

    showContactsView() {
        if (this.applyLockState()) {
            return;
        }

        this.formView.classList.add('hidden');
        this.shareView.classList.add('hidden');
        this.contactsView.classList.remove('hidden');
        this.render();
    }

    showFormView(contactId = null) {
        if (this.applyLockState()) {
            return;
        }

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
        if (this.applyLockState()) {
            return;
        }

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
                            birthday: ''
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
        if (this.applyLockState()) {
            return;
        }

        this.sharedData = sharedData;
        this.pendingStartView = 'share';
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
        if (this.applyLockState()) {
            return;
        }

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

        if (this.applyLockState()) {
            return;
        }

        const contact = {
            name: this.nameInput.value.trim(),
            phone: this.phoneInput.value.trim(),
            email: this.emailInput.value.trim(),
            birthday: this.birthdayInput.value
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
        if (this.applyLockState()) {
            return;
        }

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
        if (this.applyLockState()) {
            return;
        }

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
        this.updateOverlayVisibility();
    }

    closeModal() {
        this.confirmDialog.classList.add('hidden');
        this.updateOverlayVisibility();
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
let uiManager;

document.addEventListener('DOMContentLoaded', () => {
    contactManager = new ContactManager();
    uiManager = new UIManager(contactManager);
});
