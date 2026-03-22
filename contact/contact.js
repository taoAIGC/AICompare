function createContactItem(label, value, href) {
    const item = document.createElement('article');
    item.className = 'contact-item';

    const labelEl = document.createElement('div');
    labelEl.className = 'contact-item-label';
    labelEl.textContent = label;
    item.appendChild(labelEl);

    const valueEl = href ? document.createElement('a') : document.createElement('div');
    valueEl.className = href ? 'contact-item-link' : 'contact-item-value';
    valueEl.textContent = value;

    if (href) {
        valueEl.href = href;
        valueEl.target = '_blank';
        valueEl.rel = 'noopener noreferrer';
    }

    item.appendChild(valueEl);
    return item;
}

async function renderContactInfo() {
    const contactList = document.getElementById('contactList');
    if (!contactList) return;

    try {
        const contact = await window.AppConfigManager.getContactInfo();
        const items = [
            { label: '微信', value: contact.wechat },
            { label: 'GitHub', value: contact.github, href: contact.github },
            { label: '邮箱', value: contact.email, href: contact.email ? `mailto:${contact.email}` : '' }
        ].filter(item => item.value);

        contactList.innerHTML = '';

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'contact-empty';
            empty.textContent = 'appConfig.json 中还没有配置联系方式。';
            contactList.appendChild(empty);
            return;
        }

        items.forEach((item) => {
            contactList.appendChild(createContactItem(item.label, item.value, item.href));
        });
    } catch (error) {
        contactList.innerHTML = '';

        const empty = document.createElement('div');
        empty.className = 'contact-empty';
        empty.textContent = '联系方式加载失败，请检查 appConfig.json。';
        contactList.appendChild(empty);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderContactInfo();
});
