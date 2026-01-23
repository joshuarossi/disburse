/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as __tests___factories from "../__tests__/factories.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as beneficiaries from "../beneficiaries.js";
import type * as billing from "../billing.js";
import type * as disbursements from "../disbursements.js";
import type * as lib_rbac from "../lib/rbac.js";
import type * as migrations_backfillBeneficiaryType from "../migrations/backfillBeneficiaryType.js";
import type * as orgs from "../orgs.js";
import type * as reports from "../reports.js";
import type * as safes from "../safes.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "__tests__/factories": typeof __tests___factories;
  audit: typeof audit;
  auth: typeof auth;
  beneficiaries: typeof beneficiaries;
  billing: typeof billing;
  disbursements: typeof disbursements;
  "lib/rbac": typeof lib_rbac;
  "migrations/backfillBeneficiaryType": typeof migrations_backfillBeneficiaryType;
  orgs: typeof orgs;
  reports: typeof reports;
  safes: typeof safes;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
