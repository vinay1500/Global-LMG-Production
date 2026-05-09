import React from 'react';

type ErrorBoundaryState = {
  error: Error | null;
  errorReferenceId: string | null;
};

const createErrorReferenceId = (error: Error) => {
  const input = `${error.message}${Date.now()}`;
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index);
  }

  return Math.abs(hash).toString(36).padStart(8, '0').slice(0, 8);
};

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    error: null,
    errorReferenceId: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
      errorReferenceId: createErrorReferenceId(error),
    };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Client app render error', error, errorInfo);
      return;
    }

    console.error('client_frontend.runtime_error', {
      referenceId: this.state.errorReferenceId,
    });
  }

  public render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafafa] px-6 py-16">
        <div className="max-w-md rounded-[2rem] border border-red-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
            Something went wrong
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            The portal hit a display error. Reload the page to try again.
          </p>
          {!import.meta.env.DEV && this.state.errorReferenceId ? (
            <p className="mt-3 text-xs text-gray-400">Reference: {this.state.errorReferenceId}</p>
          ) : null}
          <button
            className="mt-6 rounded-full bg-gray-900 px-5 py-3 text-sm text-white hover:bg-black"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload page
          </button>
        </div>
      </main>
    );
  }
}
