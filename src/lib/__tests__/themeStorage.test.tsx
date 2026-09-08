import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { ThemeProvider } from "../../providers/ThemeProvider";
import { ThemeContext } from "../theme";
vi.mock("convex/react", () => ({
  useQuery: () => null,
  useMutation: () => vi.fn(),
}));
vi.mock("@/lib/session", () => ({ useSessionToken: () => null }));
afterEach(() => vi.restoreAllMocks());
function Switcher() {
  const theme = useContext(ThemeContext)!;
  return <button onClick={theme.toggleTheme}>{theme.theme}</button>;
}
it("renders and changes appearance when browser preference storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  render(
    <ThemeProvider>
      <Switcher />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "light" }));
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
  expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
});
