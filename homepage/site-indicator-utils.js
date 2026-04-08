function getHomepageSiteIndicatorIcon(site) {
    if (!site || site.supportIframe !== false) {
        return null;
    }

    return '../icons/circle-arrow-out-up-right.svg';
}

if (typeof window !== 'undefined') {
    window.HomepageSiteIndicatorUtils = {
        getHomepageSiteIndicatorIcon
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getHomepageSiteIndicatorIcon
    };
}
