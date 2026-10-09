import { useCallback, useEffect, useState } from 'react';
import { voiceRangesSchema, type VoicePartRanges } from '@choirscore/shared';
import { AppHeader } from '../components/AppHeader';
import {
  getAdminSettings,
  updateFirstLoginPasswordSetting,
  updateVoiceRangesSetting,
} from '../lib/adminSettings';
import { VoiceRangesEditor } from './VoiceRangesEditor';
import type { GetAdminSettingsResponse } from '@choirscore/shared';

type SavingSetting = 'security' | 'voiceRanges' | null;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<GetAdminSettingsResponse | null>(
    null
  );
  const [draft, setDraft] = useState<boolean | null>(null);
  const [voiceRangesDraft, setVoiceRangesDraft] =
    useState<VoicePartRanges | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState<SavingSetting>(null);
  const [saveError, setSaveError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [voiceRangesSaveError, setVoiceRangesSaveError] = useState('');
  const [voiceRangesSavedMessage, setVoiceRangesSavedMessage] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setVoiceRangesSaveError('');
    try {
      const current = await getAdminSettings();
      setSettings(current);
      setDraft(current.requirePasswordChangeAtFirstLogin);
      setVoiceRangesDraft(current.voiceRanges);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function saveSettings() {
    if (draft === null || saving !== null || !settings) return;
    setSaving('security');
    setSaveError('');
    setSavedMessage('');
    try {
      const updated = await updateFirstLoginPasswordSetting(draft);
      setSettings(updated);
      setDraft(updated.requirePasswordChangeAtFirstLogin);
      setVoiceRangesDraft(updated.voiceRanges);
      setSavedMessage('Your security setting has been saved.');
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(null);
    }
  }

  async function saveVoiceRanges() {
    if (voiceRangesDraft === null || saving !== null || !settings) return;
    const validation = voiceRangesSchema.safeParse(voiceRangesDraft);
    if (!validation.success) {
      setVoiceRangesSaveError(
        validation.error.issues[0]?.message ??
          'Enter valid pitch ranges with comfortable ranges inside hard limits.'
      );
      setVoiceRangesSavedMessage('');
      return;
    }

    setSaving('voiceRanges');
    setVoiceRangesSaveError('');
    setVoiceRangesSavedMessage('');
    try {
      const updated = await updateVoiceRangesSetting(validation.data);
      setSettings(updated);
      setDraft(updated.requirePasswordChangeAtFirstLogin);
      setVoiceRangesDraft(updated.voiceRanges);
      setVoiceRangesSavedMessage('Voice ranges have been saved.');
    } catch (error) {
      setVoiceRangesSaveError(errorMessage(error));
    } finally {
      setSaving(null);
    }
  }

  const changed =
    settings !== null && draft !== settings.requirePasswordChangeAtFirstLogin;
  const voiceRangesChanged =
    settings !== null &&
    voiceRangesDraft !== null &&
    JSON.stringify(voiceRangesDraft) !== JSON.stringify(settings.voiceRanges);

  return (
    <div className="app-page">
      <AppHeader />
      <main className="admin-settings-main" id="main-content" tabIndex={-1}>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">ADMINISTRATION · SETTINGS</p>
            <h1>Admin settings</h1>
            <p>Manage account security and the choir’s voice ranges.</p>
          </div>
        </div>

        <section
          className="admin-settings-card"
          aria-labelledby="first-login-setting-title"
        >
          <div className="admin-settings-card__heading">
            <span className="admin-settings-card__icon" aria-hidden="true">
              ⌑
            </span>
            <div>
              <p className="eyebrow">ACCOUNT SECURITY</p>
              <h2 id="first-login-setting-title">First sign-in</h2>
              <p>
                Choose whether new and reset accounts must change their password
                before using ChoirScore.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="settings-load-state" aria-busy="true" role="status">
              Loading security settings…
            </div>
          ) : loadError ? (
            <div
              className="settings-load-state settings-load-state--error"
              role="alert"
            >
              <strong>Settings could not be loaded</strong>
              <span>{loadError}</span>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => void loadSettings()}
              >
                Try again
              </button>
            </div>
          ) : draft === null ? null : (
            <>
              <div className="first-login-setting">
                <div className="first-login-setting__copy">
                  <label htmlFor="require-first-login-change">
                    <strong>Require password change at first login</strong>
                  </label>
                  <p id="first-login-setting-help">
                    When enabled, newly created and password-reset accounts must
                    choose a personal password before opening protected pages.
                  </p>
                </div>
                <div className="toggle-control">
                  <input
                    id="require-first-login-change"
                    type="checkbox"
                    role="switch"
                    aria-describedby="first-login-setting-help"
                    checked={draft}
                    disabled={saving !== null}
                    onChange={(event) => {
                      setDraft(event.target.checked);
                      setSaveError('');
                      setSavedMessage('');
                    }}
                  />
                  <span aria-hidden="true" />
                </div>
              </div>

              {!draft ? (
                <div className="settings-security-warning" role="alert">
                  <strong>First-login password changes are disabled.</strong>
                  <p>
                    Users keep their supplied or generated password until an
                    administrator resets it. Passwords that are shared widely or
                    posted in a group chat can expose choir accounts; share
                    credentials privately with the account holder.
                  </p>
                </div>
              ) : null}

              {saveError ? (
                <div className="form-alert form-alert--error" role="alert">
                  {saveError}
                </div>
              ) : null}
              {savedMessage ? (
                <div
                  className="feedback-banner feedback-banner--success"
                  role="status"
                >
                  <span aria-hidden="true">✓</span>
                  <span>{savedMessage}</span>
                </div>
              ) : null}

              <div className="admin-settings-card__footer">
                <span>
                  {draft
                    ? 'New and reset accounts will be prompted to choose a personal password.'
                    : 'Supplied and generated passwords stay active until reset.'}
                </span>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={!changed || saving !== null}
                  onClick={() => void saveSettings()}
                >
                  {saving === 'security' ? 'Saving…' : 'Save setting'}
                </button>
              </div>
            </>
          )}
        </section>

        <section
          className="admin-settings-card admin-settings-card--voice-ranges"
          aria-labelledby="voice-ranges-setting-title"
        >
          <div className="admin-settings-card__heading">
            <span className="admin-settings-card__icon" aria-hidden="true">
              ♪
            </span>
            <div>
              <p className="eyebrow">M4 RANGE FIT</p>
              <h2 id="voice-ranges-setting-title">Voice ranges</h2>
              <p>
                Set comfortable and hard limits for each part. Range-fit
                suggestions use these values when evaluating score parts S, A, T
                and B.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="settings-load-state" aria-busy="true" role="status">
              Loading voice ranges…
            </div>
          ) : loadError ? (
            <div
              className="settings-load-state settings-load-state--error"
              role="alert"
            >
              <strong>Voice ranges could not be loaded</strong>
              <span>{loadError}</span>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => void loadSettings()}
              >
                Try again
              </button>
            </div>
          ) : voiceRangesDraft === null ? null : (
            <>
              <VoiceRangesEditor
                ranges={voiceRangesDraft}
                disabled={saving !== null}
                onChange={(updated) => {
                  setVoiceRangesDraft(updated);
                  setVoiceRangesSaveError('');
                  setVoiceRangesSavedMessage('');
                }}
              />
              {voiceRangesSaveError ? (
                <div className="form-alert form-alert--error" role="alert">
                  {voiceRangesSaveError}
                </div>
              ) : null}
              {voiceRangesSavedMessage ? (
                <div
                  className="feedback-banner feedback-banner--success"
                  role="status"
                >
                  <span aria-hidden="true">✓</span>
                  <span>{voiceRangesSavedMessage}</span>
                </div>
              ) : null}
              <div className="admin-settings-card__footer">
                <span>
                  Comfortably singing inside the outer hard limit is required
                  for range-fit validation.
                </span>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={!voiceRangesChanged || saving !== null}
                  onClick={() => void saveVoiceRanges()}
                >
                  {saving === 'voiceRanges' ? 'Saving…' : 'Save voice ranges'}
                </button>
              </div>
            </>
          )}
        </section>
      </main>
      <footer className="app-footer">
        <span>ChoirScore · Kings &amp; Queens Choir</span>
        <span>Private by design</span>
      </footer>
    </div>
  );
}
