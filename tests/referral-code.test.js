const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const serverSource = fs.readFileSync('backend/server.js', 'utf8');
const stripePaymentSource = fs.readFileSync('firebase/stripe-payment.js', 'utf8');
const optionsHtml = fs.readFileSync('options/options.html', 'utf8');
const optionsSource = fs.readFileSync('options/options.js', 'utf8');

test('backend creates stable per-user referral codes and exposes a protected lookup route', () => {
  assert.match(serverSource, /const referralCodeCollection = 'referralCodes'/);
  assert.match(serverSource, /const referralRedemptionCollection = 'referralRedemptions'/);
  assert.match(serverSource, /async function getOrCreateReferralCodeForUser\(user\)/);
  assert.match(serverSource, /referralCode:\s*normalizedCode/);
  assert.match(serverSource, /app\.get\('\/referralCode'/);
  assert.match(serverSource, /const user = await requireUser\(req\)/);
});

test('backend awards 3 days to the redeemer and 1 day to the code owner', () => {
  assert.match(serverSource, /recipientRewardDays:\s*3/);
  assert.match(serverSource, /ownerRewardDays:\s*1/);
  assert.match(serverSource, /recipientRewardDays,[\s\S]{0,80}'referral_gift'/);
  assert.match(serverSource, /ownerRewardDays,[\s\S]{0,80}'referral_invite'/);
  assert.match(serverSource, /referralRewardDaysEarned:\s*db\.increment\(ownerRewardDays\)/);
});

test('backend prevents self-redemption and repeated referral redemption by the same user', () => {
  assert.match(serverSource, /if \(ownerUid === user\.uid\)/);
  assert.match(serverSource, /You cannot redeem your own referral code/);
  assert.match(serverSource, /referralRedemptionCollection\)\.doc\(user\.uid\)/);
  assert.match(serverSource, /You have already claimed a referral reward/);
});

test('unknown redeem codes fall through to the referral-code redemption path', () => {
  assert.match(serverSource, /const existingCodeSnap = await codeRef\.get\(\)/);
  assert.match(serverSource, /return redeemReferralCode\(req,\s*normalizedCode,\s*user\)/);
});

test('extension surfaces the invite code in the redeem tab and can copy it', () => {
  assert.match(stripePaymentSource, /async function getReferralCode\(\)/);
  assert.match(stripePaymentSource, /window\.getReferralCode = getReferralCode/);
  assert.match(optionsHtml, /id="membershipReferralCode"/);
  assert.match(optionsHtml, /id="copyMembershipReferralCode"/);
  assert.match(optionsSource, /loadMembershipReferralCode\(uid\)/);
  assert.match(optionsSource, /copyTextToClipboard\(code\)/);
});
