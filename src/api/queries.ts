// Every query and mutation rw sends, in one place. A test checks each one
// against the developer API's schema (schema/developer-api.graphql), so a
// change to the API that would break rw fails rw's tests first.

const EXTERNAL_IDS = "externalIds { id source }";

/**
 * A kind of record rw can list and show. Adding one here gives it
 * `rw <plural> list` and `rw <plural> show <id>`.
 */
export interface RecordKind {
  /** The command group and the query for many: `stations`. */
  plural: string;
  /** The query for one: `station`. */
  singular: string;
  /** What `list` and `show` ask for. */
  fields: string;
  /** Table columns in a terminal: field name and header. */
  columns: Array<[field: string, header: string]>;
  /** Commands worth running from one record of this kind. */
  next?: (record: Record<string, any>) => Array<{ action: string; cmd: string }>;
  description: string;
}

export const RECORD_KINDS: RecordKind[] = [
  {
    plural: "workcenters",
    singular: "workcenter",
    description: "Groups of stations: cells and lines",
    fields: "id name description parentId createdAt updatedAt",
    columns: [
      ["id", "ID"],
      ["name", "NAME"],
      ["parentId", "PARENT"],
    ],
    next: (wc) =>
      wc.parentId ? [{ action: "Show the workcenter it sits in", cmd: `rw workcenters show ${wc.parentId}` }] : [],
  },
  {
    plural: "stations",
    singular: "station",
    description: "Machines and work stations",
    fields:
      "id name description sortOrder workcenterId currentJobId archivedAt createdAt updatedAt deletedAt " +
      "workcenter { id name } currentJob { id name }",
    columns: [
      ["id", "ID"],
      ["name", "NAME"],
      ["workcenter", "WORKCENTER"],
      ["currentJob", "CURRENT JOB"],
    ],
    next: (station) => [
      ...(station.currentJobId
        ? [{ action: "Show the job it is running", cmd: `rw jobs show ${station.currentJobId}` }]
        : []),
      ...(station.workcenterId
        ? [{ action: "Show its workcenter", cmd: `rw workcenters show ${station.workcenterId}` }]
        : []),
    ],
  },
  {
    plural: "jobs",
    singular: "job",
    description: "What stations run, with their standards",
    fields:
      "id name description version standardRate standardRateUnit standardCycle productsPerCycle standardQuantity " +
      "archivedAt createdAt updatedAt deletedAt",
    columns: [
      ["id", "ID"],
      ["name", "NAME"],
      ["standardRate", "RATE"],
      ["standardRateUnit", "UNIT"],
      ["version", "VERSION"],
    ],
  },
  {
    plural: "products",
    singular: "product",
    description: "Parts the plant makes",
    fields: `id sku name description externalSku itemCost weight version archivedAt createdAt updatedAt deletedAt ${EXTERNAL_IDS}`,
    columns: [
      ["id", "ID"],
      ["sku", "SKU"],
      ["name", "NAME"],
      ["externalIds", "OUTSIDE IDS"],
    ],
  },
  {
    plural: "materials",
    singular: "material",
    description: "What products are made from",
    fields:
      "id materialNumber name description classification shortCode externalNumber unitCost version " +
      `archivedAt createdAt updatedAt deletedAt ${EXTERNAL_IDS}`,
    columns: [
      ["id", "ID"],
      ["materialNumber", "NUMBER"],
      ["name", "NAME"],
      ["unitCost", "UNIT COST"],
    ],
  },
  {
    plural: "customers",
    singular: "customer",
    description: "Who orders are for",
    fields: `id name createdAt updatedAt deletedAt ${EXTERNAL_IDS}`,
    columns: [
      ["id", "ID"],
      ["name", "NAME"],
      ["externalIds", "OUTSIDE IDS"],
    ],
  },
  {
    plural: "orders",
    singular: "order",
    description: "Orders to make products",
    fields:
      "id orderNumber status poNumber customerId customer { id name } defaultTargetQuantity startDate dueDate " +
      `openedAt completedAt cancelledAt notes createdAt updatedAt deletedAt ${EXTERNAL_IDS} ` +
      "lines { id productId targetQuantity product { id sku name } }",
    columns: [
      ["id", "ID"],
      ["orderNumber", "ORDER"],
      ["status", "STATUS"],
      ["customer", "CUSTOMER"],
      ["dueDate", "DUE"],
    ],
    next: (order) =>
      order.customerId ? [{ action: "Show the customer", cmd: `rw customers show ${order.customerId}` }] : [],
  },
];

export function listQuery(kind: RecordKind): string {
  return (
    `query List($first: Int, $after: String, $updatedSince: DateTime, $includeDeleted: Boolean) { ` +
    `${kind.plural}(first: $first, after: $after, updatedSince: $updatedSince, includeDeleted: $includeDeleted) ` +
    `{ nodes { ${kind.fields} } pageInfo { endCursor hasNextPage } } }`
  );
}

export function showQuery(kind: RecordKind): string {
  return `query Show($id: ID!) { ${kind.singular}(id: $id) { ${kind.fields} } }`;
}

export const SITE = "query Site { site { id name description timezone updatedAt } }";

const UPSERT_ERRORS = "errors { field code message }";

export const UPSERT_MATERIALS =
  "mutation UpsertMaterials($source: String, $materials: [MaterialInput!]!) { " +
  `upsertMaterials(source: $source, materials: $materials) { results { action externalId material { id materialNumber name } } ${UPSERT_ERRORS} } }`;

export const UPSERT_PRODUCTS =
  "mutation UpsertProducts($source: String, $products: [ProductInput!]!) { " +
  `upsertProducts(source: $source, products: $products) { results { action externalId product { id sku name } } ${UPSERT_ERRORS} } }`;

export const UPSERT_ORDER =
  "mutation UpsertOrder($source: String, $order: OrderInput!) { " +
  `upsertOrder(source: $source, order: $order) { action order { id orderNumber status } ${UPSERT_ERRORS} } }`;

const WEBHOOK = "id url events enabled createdAt updatedAt";
const DELIVERY = "id eventId type status attempts responseStatus error startedAt finishedAt nextAttemptAt";

export const WEBHOOKS = `query Webhooks { webhooks { ${WEBHOOK} } }`;

export const WEBHOOK_DELIVERIES =
  "query Deliveries($webhookId: ID!, $status: WebhookDeliveryStatus, $first: Int) { " +
  `webhookDeliveries(webhookId: $webhookId, status: $status, first: $first) { ${DELIVERY} } }`;

export const CREATE_WEBHOOK =
  "mutation CreateWebhook($webhook: WebhookInput!) { " +
  `createWebhook(webhook: $webhook) { secret webhook { ${WEBHOOK} } } }`;

export const UPDATE_WEBHOOK =
  "mutation UpdateWebhook($id: ID!, $webhook: WebhookUpdateInput!) { " +
  `updateWebhook(id: $id, webhook: $webhook) { ${WEBHOOK} } }`;

export const DELETE_WEBHOOK = "mutation DeleteWebhook($id: ID!) { deleteWebhook(id: $id) }";

export const ROTATE_WEBHOOK_SECRET =
  "mutation RotateWebhookSecret($id: ID!) { " + `rotateWebhookSecret(id: $id) { secret webhook { ${WEBHOOK} } } }`;

export const SEND_TEST_WEBHOOK = `mutation SendTestWebhook($id: ID!) { sendTestWebhook(id: $id) { ${DELIVERY} } }`;

export const REDELIVER_WEBHOOK = `mutation RedeliverWebhook($deliveryId: ID!) { redeliverWebhook(deliveryId: $deliveryId) { ${DELIVERY} } }`;

/** What a webhook can follow, as the API names them. A test checks this against the schema. */
export const WEBHOOK_EVENTS = [
  "CUSTOMER_CREATED",
  "CUSTOMER_DELETED",
  "CUSTOMER_UPDATED",
  "JOB_CREATED",
  "JOB_DELETED",
  "JOB_UPDATED",
  "LINEUP_RUN_CREATED",
  "LINEUP_RUN_UPDATED",
  "MATERIAL_CREATED",
  "MATERIAL_DELETED",
  "MATERIAL_UPDATED",
  "ORDER_CREATED",
  "ORDER_DELETED",
  "ORDER_UPDATED",
  "PRODUCT_CREATED",
  "PRODUCT_DELETED",
  "PRODUCT_UPDATED",
] as const;

export const DELIVERY_STATUSES = ["FAILED", "PENDING", "RETRYING", "SUCCEEDED"] as const;

/** Every fixed query and mutation, for the schema test. */
export const ALL_OPERATIONS: Record<string, string> = {
  SITE,
  UPSERT_MATERIALS,
  UPSERT_PRODUCTS,
  UPSERT_ORDER,
  WEBHOOKS,
  WEBHOOK_DELIVERIES,
  CREATE_WEBHOOK,
  UPDATE_WEBHOOK,
  DELETE_WEBHOOK,
  ROTATE_WEBHOOK_SECRET,
  SEND_TEST_WEBHOOK,
  REDELIVER_WEBHOOK,
  ...Object.fromEntries(
    RECORD_KINDS.flatMap((kind) => [
      [`${kind.plural}.list`, listQuery(kind)],
      [`${kind.plural}.show`, showQuery(kind)],
    ]),
  ),
};
