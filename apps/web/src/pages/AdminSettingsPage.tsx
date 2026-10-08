import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import {
  getAdminSettings,
  updateFirstLoginPasswordSetting,
} from '../lib/adminSettings';
import type { GetAdminSettingsResponse } from '@choirscore/shared';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setSaveError('');
    try {
      const current = await getAdminSettings();
      setSettings(current);
      setDraft(current.requirePasswordChangeAtFirstLogin);
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
    if (draft === null || saving || !settings) return;
    setSaving(true);
    setSaveError('');
    setSavedMessage('');
    try {
      const updated = await updateFirstLoginPasswordSetting(draft);
      setSettings(updated);
      setDraft(updated.requirePasswordChangeAtFirstLogin);
      setSavedMessage('Your security setting has been saved.');
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const changed =
    settings !== null && draft !== settings.requirePasswordChangeAtFirstLogin;

  return (
    <div className="app-page">
      <AppHeader />
      <main className="admin-settings-main">
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">ADMINISTRATION · SECURITY</p>
            <h1>Admin settings</h1>
            <p>Set the sign-in protections for new and reset accounts.</p>
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
                <label className="toggle-control">
                  <input
                    id="require-first-login-change"
                    type="checkbox"
                    role="switch"
                    aria-describedby="first-login-setting-help"
                    checked={draft}
                    disabled={saving}
                    onChange={(event) => {
                      setDraft(event.target.checked);
                      setSaveError('');
                      setSavedMessage('');
                    }}
                  />
                  <span aria-hidden="true" />
                  <span className="visually-hidden">
                    Require password change at first login
                  </span>
                </label>
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
                  disabled={!changed || saving}
                  onClick={() => void saveSettings()}
                >
                  {saving ? 'Saving…' : 'Save setting'}
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
