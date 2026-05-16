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

// UI Manager
class UIManager {
    constructor(contactManager) {
        this.contactManager = contactManager;
        this.currentEditId = null;
        this.sharedData = null;
        this.initElements();
        this.attachEventListeners();
        this.render();
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
    }

    attachEventListeners() {
        this.addContactBtn.addEventListener('click', () => this.handleAddContact());
        this.importBtn.addEventListener('click', () => this.importFile.click());
        this.cancelBtn.addEventListener('click', () => this.showContactsView());
        this.contactForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        this.importFile.addEventListener('change', (e) => this.handleImport(e));
        this.confirmYes.addEventListener('click', () => this.confirmDelete());
        this.confirmNo.addEventListener('click', () => this.closeModal());
        this.modalOverlay.addEventListener('click', () => this.closeModal());

        // Check for shared data
        this.checkForSharedData();
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
            card.classList.add('share-option');
            card.addEventListener('click', () => this.handleShare(contact));
            this.shareContactsList.appendChild(card);
        });
    }

    handleShare(contact) {
        const sharedText = this.sharedData.text || this.sharedData.url || '';
        const isEmail = this.sharedData.type === 'email' || !this.sharedData.type;

        // Offer both options
        const choice = confirm(`Share via:\n\nOK = Email\nCancel = Text Message`);

        if (choice && contact.email) {
            // Email
            window.location.href = `mailto:${contact.email}?subject=Check this out&body=${encodeURIComponent(sharedText)}`;
        } else if (!choice && contact.phone) {
            // SMS
            window.location.href = `sms:${contact.phone}?body=${encodeURIComponent(sharedText)}`;
        } else {
            alert('Contact does not have the required information for this share type.');
        }

        this.showContactsView();
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
let uiManager;

document.addEventListener('DOMContentLoaded', () => {
    contactManager = new ContactManager();
    uiManager = new UIManager(contactManager);
});
