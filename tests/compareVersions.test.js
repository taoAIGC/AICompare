/**
 * Tests for the compareVersions() function from baseConfig.js.
 *
 * The function is extracted here to be testable standalone, since the original
 * file wraps everything in environment-detection blocks and depends on chrome.*.
 */

// Extract compareVersions from baseConfig.js source for standalone testing
function compareVersions(version1, version2) {
  if (version1 === version2) {
    return 0;
  }

  if (typeof version1 === 'number' && typeof version2 === 'number') {
    return version1 > version2 ? 1 : -1;
  }

  const parseVersion = (version) => {
    if (typeof version === 'string') {
      const cleanVersion = version.replace(/^v/, '');
      const parts = cleanVersion.split('.').map((part) => {
        const match = part.match(/^(\d+)(.*)$/);
        return {
          number: parseInt(match ? match[1] : part, 10) || 0,
          suffix: match ? match[2] : '',
        };
      });
      return parts;
    }
    return [{ number: parseInt(version, 10) || 0, suffix: '' }];
  };

  const v1Parts = parseVersion(version1);
  const v2Parts = parseVersion(version2);

  const maxLength = Math.max(v1Parts.length, v2Parts.length);

  for (let i = 0; i < maxLength; i++) {
    const v1Part = v1Parts[i] || { number: 0, suffix: '' };
    const v2Part = v2Parts[i] || { number: 0, suffix: '' };

    if (v1Part.number !== v2Part.number) {
      return v1Part.number > v2Part.number ? 1 : -1;
    }

    if (v1Part.suffix !== v2Part.suffix) {
      if (v1Part.suffix === '' && v2Part.suffix !== '') {
        return 1;
      }
      if (v1Part.suffix !== '' && v2Part.suffix === '') {
        return -1;
      }
      return v1Part.suffix > v2Part.suffix ? 1 : -1;
    }
  }

  return 0;
}

describe('compareVersions', () => {
  describe('equal versions', () => {
    test('returns 0 for identical strings', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    test('returns 0 for identical numbers', () => {
      expect(compareVersions(42, 42)).toBe(0);
    });

    test('returns 0 for identical complex versions', () => {
      expect(compareVersions('2.15.10', '2.15.10')).toBe(0);
    });
  });

  describe('major version differences', () => {
    test('newer major version returns 1', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
    });

    test('older major version returns -1', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    });

    test('large major version difference', () => {
      expect(compareVersions('10.0.0', '2.0.0')).toBe(1);
    });
  });

  describe('minor version differences', () => {
    test('newer minor version returns 1', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    });

    test('older minor version returns -1', () => {
      expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
    });
  });

  describe('patch version differences', () => {
    test('newer patch version returns 1', () => {
      expect(compareVersions('1.0.2', '1.0.1')).toBe(1);
    });

    test('older patch version returns -1', () => {
      expect(compareVersions('1.0.1', '1.0.2')).toBe(-1);
    });
  });

  describe('v prefix handling', () => {
    test('strips v prefix for comparison', () => {
      expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    });

    test('both with v prefix', () => {
      expect(compareVersions('v2.0.0', 'v1.0.0')).toBe(1);
    });
  });

  describe('pre-release versions', () => {
    test('release > pre-release', () => {
      expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1);
    });

    test('pre-release < release', () => {
      expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
    });

    test('pre-release suffix ordering', () => {
      expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1);
    });
  });

  describe('different length versions', () => {
    test('3-part vs 2-part', () => {
      expect(compareVersions('1.0.0', '1.0')).toBe(0);
    });

    test('3-part with non-zero vs 2-part', () => {
      expect(compareVersions('1.0.1', '1.0')).toBe(1);
    });
  });

  describe('numeric timestamp comparisons', () => {
    test('newer timestamp returns 1', () => {
      expect(compareVersions(1700000000, 1600000000)).toBe(1);
    });

    test('older timestamp returns -1', () => {
      expect(compareVersions(1600000000, 1700000000)).toBe(-1);
    });
  });

  describe('actual project version comparisons', () => {
    test('current siteHandlers version vs older', () => {
      expect(compareVersions('1.1.3', '1.1.2')).toBe(1);
    });

    test('current siteHandlers version vs newer', () => {
      expect(compareVersions('1.1.3', '1.2.0')).toBe(-1);
    });

    test('same siteHandlers version', () => {
      expect(compareVersions('1.1.3', '1.1.3')).toBe(0);
    });
  });
});
