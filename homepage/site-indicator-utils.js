function getHomepageSiteIndicatorIcon(site) {
    if (!site || site.supportIframe !== false) {
        return null;
    }

    return '../icons/circle-arrow-out-up-right.svg';
}

function deriveHomepageSiteIconFileName(site) {
    try {
        const hostname = new URL(site.url).hostname.toLowerCase();
        return hostname.replace(/[^a-z0-9.-]/g, '_') + '.png';
    } catch (_) {
        return 'icon16.png';
    }
}

function getHomepageSiteIconPath(site) {
    if (site && typeof site.icon === 'string' && site.icon.trim()) {
        const icon = site.icon.trim();
        if (/^(https?:|data:|blob:|chrome-extension:)/i.test(icon)) {
            return icon;
        }
        return `../siteIcons/${icon}`;
    }

    return `../siteIcons/${deriveHomepageSiteIconFileName(site)}`;
}

function getHomepageSiteIconFallbackPath() {
    return '../icons/icon16.png';
}

if (typeof window !== 'undefined') {
    window.HomepageSiteIndicatorUtils = {
        getHomepageSiteIndicatorIcon,
        getHomepageSiteIconPath,
        getHomepageSiteIconFallbackPath
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getHomepageSiteIndicatorIcon,
        getHomepageSiteIconPath,
        getHomepageSiteIconFallbackPath
    };
}
