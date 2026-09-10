import { tx } from "@/lib/workspaceI18n";
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode; withinWorkspace?: boolean },
  { failed: boolean; moduleFailure: boolean }
> {
  state = { failed: false, moduleFailure: false };

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    return {
      failed: true,
      moduleFailure:
        /dynamically imported module|module script|loading chunk|chunkloaderror/i.test(
          message,
        ),
    };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.withinWorkspace)
      return (
        <section className="workspace-panel p-8" role="alert">
          <h1 className="text-2xl font-semibold">
            {tx("This page could not load")}
          </h1>
          <p className="workspace-description mt-3">
            {this.state.moduleFailure
              ? tx(
                  "Part of the app could not be downloaded. Reload to get the current version.",
                )
              : tx(
                  "This section is temporarily unavailable. Reload to try again.",
                )}{" "}
            {tx(
              "You can still use the workspace navigation to open another section.",
            )}
          </p>
          <button
            className="workspace-button workspace-button-primary mt-5"
            onClick={() => window.location.reload()}
          >
            {tx("Reload page")}
          </button>
        </section>
      );
    return (
      <main className="flex min-h-screen items-center justify-center bg-navy-950 px-6 text-white">
        <div role="alert" className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">
            {tx("This page could not load")}
          </h1>
          <p className="mt-3 text-slate-400">
            {tx("Reload the page to try again.")}
          </p>
          <button
            className="workspace-button workspace-button-primary mt-6"
            onClick={() => window.location.reload()}
          >
            {tx("Reload page")}
          </button>
          <a className="ml-4 text-accent-400 underline" href="/">
            {tx("Go home")}
          </a>
        </div>
      </main>
    );
  }
}
