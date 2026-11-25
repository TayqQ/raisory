import { z } from "zod";

// Zod schemas for the Companies House responses SignalFeed reads (A34, A35,
// A37, A38). Unknown keys are ignored. Officer, PSC and charges data is never
// described here, so it can never be parsed or stored (D58).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = z.string().regex(ISO_DATE);
/**
 * A date that may be missing. Companies House sends "Unknown" as the
 * cessation date of some converted or closed companies; any value that is not
 * an ISO date is read as no date, so one odd item cannot fail a whole search.
 */
const optionalDate = z
  .string()
  .nullish()
  .transform((value) => (value != null && ISO_DATE.test(value) ? value : null));

export const chAddressSchema = z.object({
  postal_code: z.string().nullish(),
  locality: z.string().nullish(),
});

export const chSearchItemSchema = z.object({
  title: z.string(),
  company_number: z.string(),
  company_status: z.string().nullish(),
  company_type: z.string().nullish(),
  date_of_creation: optionalDate,
  date_of_cessation: optionalDate,
  address: chAddressSchema.nullish(),
});

export const chSearchResponseSchema = z.object({
  total_results: z.number().int().nonnegative().optional(),
  items: z.array(chSearchItemSchema).default([]),
});

export const chProfileSchema = z.object({
  company_name: z.string(),
  company_number: z.string(),
  // Missing on charities and registered societies (see `getCompany`).
  company_status: z.string().nullish(),
  company_status_detail: z.string().nullish(),
  type: z.string(),
  date_of_creation: date.nullish(),
  date_of_cessation: optionalDate,
  sic_codes: z.array(z.string()).default([]),
  registered_office_address: chAddressSchema.nullish(),
  accounts: z
    .object({
      last_accounts: z
        .object({
          type: z.string().nullish(),
          period_end_on: optionalDate,
          made_up_to: optionalDate,
        })
        .nullish(),
    })
    .nullish(),
  previous_company_names: z.array(z.object({ name: z.string() })).default([]),
  has_insolvency_history: z.boolean().nullish(),
  links: z.object({ insolvency: z.string().optional() }).nullish(),
  etag: z.string().nullish(),
});

export const chFilingItemSchema = z.object({
  transaction_id: z.string(),
  type: z.string(),
  date,
  action_date: optionalDate,
  description_values: z
    .object({
      capital: z
        .array(z.object({ currency: z.string(), figure: z.string() }))
        .nullish(),
    })
    .nullish(),
  links: z.object({ document_metadata: z.string().optional() }).nullish(),
});

export const chFilingHistorySchema = z.object({
  total_count: z.number().int().nonnegative().optional(),
  items: z.array(chFilingItemSchema).default([]),
});

export const chAdvancedSearchSchema = z.object({
  hits: z.number().int().nonnegative(),
});

export type ChSearchItem = z.infer<typeof chSearchItemSchema>;
/** A profile with the status and incorporation date every company has. */
export type ChProfile = z.infer<typeof chProfileSchema> & {
  company_status: string;
  date_of_creation: string;
};
export type ChFilingItem = z.infer<typeof chFilingItemSchema>;
