import { GOOGLE_CLIENT_ID } from '../config/runtime';

const GOOGLE_IDENTITY_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GooglePromptMomentNotification {
  getNotDisplayedReason?: () => string;
  isDismissedMoment?: () => boolean;
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
}

interface GoogleAccountsIdApi {
  initialize: (input: {
    callback: (response: GoogleCredentialResponse) => void;
    cancel_on_tap_outside?: boolean;
    client_id: string;
    context?: 'signin';
    nonce?: string;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  prompt: (listener?: (notification: GooglePromptMomentNotification) => void) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      shape?: 'circle' | 'pill' | 'rectangular' | 'square';
      size?: 'large' | 'medium' | 'small';
      text?: 'continue_with' | 'signin_with' | 'signup_with';
      theme?: 'filled_black' | 'filled_blue' | 'outline';
      type?: 'icon' | 'standard';
      width?: number;
    }
  ) => void;
}

interface GoogleWindow {
  accounts: {
    id: GoogleAccountsIdApi;
  };
}

declare global {
  interface Window {
    google?: GoogleWindow;
  }
}

let sdkLoadPromise: Promise<void> | null = null;
const GOOGLE_SDK_LOAD_TIMEOUT_MS = 10000;

export const isGoogleIdentityConfigured = Boolean(GOOGLE_CLIENT_ID);

export const loadGoogleIdentitySdk = async () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Google sign-in is only available in the browser.');
  }

  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Google sign-in is not available right now.');
  }

  if (window.google?.accounts?.id) {
    return;
  }

  if (!sdkLoadPromise) {
    sdkLoadPromise = new Promise<void>((resolve, reject) => {
      let timeoutId: number | undefined;

      const clearPendingTimeout = () => {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      };

      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src="${GOOGLE_IDENTITY_SCRIPT_SRC}"]`
      );

      const handleLoad = () => {
        clearPendingTimeout();
        if (window.google?.accounts?.id) {
          resolve();
          return;
        }

        reject(new Error('Google sign-in SDK loaded, but the identity client is unavailable.'));
      };

      const handleError = () => {
        clearPendingTimeout();
        reject(new Error('Google sign-in SDK could not be loaded.'));
      };

      timeoutId = window.setTimeout(() => {
        reject(new Error('Google sign-in SDK timed out while loading.'));
      }, GOOGLE_SDK_LOAD_TIMEOUT_MS);

      if (existingScript) {
        existingScript.addEventListener('load', handleLoad, { once: true });
        existingScript.addEventListener('error', handleError, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });
      document.head.appendChild(script);
    }).catch((error) => {
      sdkLoadPromise = null;
      throw error;
    });
  }

  await sdkLoadPromise;
};

export const requestGoogleIdToken = async (nonce: string) => {
  await loadGoogleIdentitySdk();

  return new Promise<string>((resolve, reject) => {
    const accountsApi = window.google?.accounts?.id;

    if (!accountsApi || !GOOGLE_CLIENT_ID) {
      reject(new Error('Google sign-in is unavailable right now.'));
      return;
    }

    let settled = false;
    let promptOpened = false;

    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Google sign-in timed out. Please try again.'));
      }
    }, 60000);

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      callback();
    };

    accountsApi.initialize({
      client_id: GOOGLE_CLIENT_ID,
      context: 'signin',
      cancel_on_tap_outside: true,
      nonce,
      use_fedcm_for_prompt: true,
      callback: (response) => {
        const credential = response.credential?.trim();

        if (!credential) {
          finish(() => reject(new Error('Google sign-in did not return a valid credential.')));
          return;
        }

        finish(() => resolve(credential));
      },
    });

    accountsApi.prompt((notification) => {
      if (settled) {
        return;
      }

      const promptWasUnavailable =
        notification.isNotDisplayed?.() ||
        notification.isSkippedMoment?.();

      if (promptWasUnavailable) {
        const reason = notification.getNotDisplayedReason?.();
        finish(() =>
          reject(
            new Error(
              reason
                ? `Google sign-in is unavailable right now (${reason}).`
                : 'Google sign-in is unavailable right now.'
            )
          )
        );
        return;
      }

      if (notification.isDismissedMoment?.() && !promptOpened) {
        finish(() => reject(new Error('Google sign-in was closed before completion.')));
        return;
      }

      promptOpened = true;
    });
  });
};

export const mountGoogleIdentityButton = async (
  container: HTMLElement,
  options: {
    nonce: string;
    onCredential: (credential: string) => void;
    onError?: (error: Error) => void;
    width?: number;
  }
) => {
  await loadGoogleIdentitySdk();

  const accountsApi = window.google?.accounts?.id;

  if (!accountsApi || !GOOGLE_CLIENT_ID) {
    throw new Error('Google sign-in is unavailable right now.');
  }

  container.replaceChildren();

  accountsApi.initialize({
    client_id: GOOGLE_CLIENT_ID,
    context: 'signin',
    cancel_on_tap_outside: true,
    nonce: options.nonce,
    use_fedcm_for_prompt: true,
    callback: (response) => {
      const credential = response.credential?.trim();

      if (!credential) {
        options.onError?.(new Error('Google sign-in did not return a valid credential.'));
        return;
      }

      options.onCredential(credential);
    },
  });

  const width = Math.max(options.width || container.clientWidth || 0, 320);

  accountsApi.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    width,
  });

  return () => {
    container.replaceChildren();
  };
};
