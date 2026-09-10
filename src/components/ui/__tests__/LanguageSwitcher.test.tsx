import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { LanguageSwitcher } from "../LanguageSwitcher";
import i18n from "@/lib/i18n";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  session: "session-test" as string | undefined,
}));
vi.mock("convex/react", () => ({ useMutation: () => mocks.save }));
vi.mock("@/lib/session", () => ({ useSessionToken: () => mocks.session }));
beforeEach(async () => {
  mocks.save.mockReset().mockResolvedValue(null);
  mocks.session = "session-test";
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});
it("persists the language in the browser and authenticated user preferences", async () => {
  render(<LanguageSwitcher inline />);
  fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
    target: { value: "es" },
  });
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith({
      sessionToken: "session-test",
      preferredLanguage: "es",
    }),
  );
  expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveValue("es");
  expect(localStorage.getItem("i18nextLng")).toBe("es");
});
it("retains the local choice and allows retry after account preference saving fails", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Unavailable"));
  render(<LanguageSwitcher inline />);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "pt-BR" },
  });
  await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
    "O idioma foi alterado neste dispositivo.",
  );
  expect(screen.getByRole("combobox")).toHaveValue("pt-BR");
  expect(localStorage.getItem("i18nextLng")).toBe("pt-BR");
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(mocks.save).toHaveBeenCalledTimes(2);
});
it("uses the resolved language for regional browser preferences without a session", async () => {
  mocks.session = undefined;
  await act(() => i18n.changeLanguage("es-MX"));
  render(<LanguageSwitcher inline />);
  expect(screen.getByRole("combobox")).toHaveValue("es");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "pt-BR" },
  });
  await waitFor(() =>
    expect(screen.getByRole("combobox")).toHaveValue("pt-BR"),
  );
  expect(mocks.save).not.toHaveBeenCalled();
});
