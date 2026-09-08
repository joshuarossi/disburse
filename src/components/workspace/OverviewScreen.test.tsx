import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { OverviewScreen, type OverviewModel } from "./OverviewScreen";
const model: OverviewModel = {
  needsReview: 0,
  exceptionCount: 0,
  draftCount: 0,
  reviewedRecipients: 1,
  recipientsNeedReview: 0,
  exceptions: [],
  drafts: [],
  plannedDebits: [],
  plansIncomplete: false,
  unquotedFees: false,
  scheduledCount: 0,
  overdueBills: 0,
  incompleteRecipients: 0,
  recipientCount: 1,
  accountCount: 4,
  review: [],
  upcoming: [],
  recent: [],
  bills: [],
  limitedHistory: false,
};
const base = {
  token: "USDC",
  planned: "0",
  remaining: "0",
  ready: true,
  loading: false,
};
const balances = [
  { ...base, label: "Empty", amount: "0.000000" },
  {
    ...base,
    label: "Small balance",
    amount: "0.000001",
    remaining: "0.000001",
  },
  { ...base, label: "Unknown balance", amount: null, remaining: null },
  {
    ...base,
    label: "Payroll",
    amount: "0",
    planned: "1.000001",
    remaining: "-1.000001",
  },
];
function view(value = model) {
  return (
    <MemoryRouter>
      <OverviewScreen
        model={value}
        balances={balances}
        prefix="/org/demo"
        orgName="Company"
      />
    </MemoryRouter>
  );
}
describe("overview balance summary", () => {
  it("hides only confirmed empty balances while retaining small amounts, unknown funds and unfunded plans", () => {
    render(view());
    expect(
      screen.queryByRole("group", { name: "Empty · USDC" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Small balance · USDC" }),
    ).toHaveTextContent("$0.000001");
    expect(
      screen.getByRole("group", { name: "Unknown balance · USDC" }),
    ).toHaveTextContent("Unavailable");
    expect(
      screen.getByRole("group", { name: "Payroll · USDC" }),
    ).toHaveTextContent("-$1.000001");
    fireEvent.click(
      screen.getByRole("button", { name: "Show 1 empty balance" }),
    );
    expect(
      screen.getByRole("group", { name: "Empty · USDC" }),
    ).toHaveTextContent("$0.00");
    fireEvent.click(
      screen.getByRole("button", { name: "Hide empty balances" }),
    );
    expect(
      screen.queryByRole("group", { name: "Empty · USDC" }),
    ).not.toBeInTheDocument();
  });
  it("does not hide zero-balance accounts when planned-payment history is incomplete", () => {
    render(view({ ...model, plansIncomplete: true }));
    expect(
      screen.getByRole("group", { name: "Empty · USDC" }),
    ).toHaveTextContent("Incomplete history");
    expect(
      screen.queryByRole("button", { name: /Show .* empty balance/ }),
    ).not.toBeInTheDocument();
  });
});
