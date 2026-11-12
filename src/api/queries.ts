// Every query and mutation rw sends, in one place. A test checks each one
// against the developer API's schema (schema/developer-api.graphql), so a
// change to the API that would break rw fails rw's tests first.

const EXTERNAL_IDS = "externalIds { id source }";

/**
 * A kind of record rw can list and show. Adding one here gives it
 * `rw <plural> list` and `rw <plural> show <id>`.
 */
export interface RecordKind {
  /** The query for many, and the command group unless `command` says otherwise: `stations`. */
  plural: string;
  /** The command group, when it isn't `plural`: `production-runs`. */
  command?: string;
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
      "id name description version standardRate standardRateUnit standardRatePeriod standardCycle productsPerCycle " +
      `standardQuantity profileId archivedAt createdAt updatedAt deletedAt ${EXTERNAL_IDS} ` +
      "tools { id name } items { id quantity isActive cavityId product { id sku } tool { id name } }",
    columns: [
      ["id", "ID"],
      ["name", "NAME"],
      ["standardRate", "RATE"],
      ["standardRateUnit", "UNIT"],
      ["version", "VERSION"],
    ],
  },
  {
    plural: "tools",
    singular: "tool",
    description: "Molds, dies and other tools, with their cavities",
    fields: `id name description version cavityCount cavities { id name position } archivedAt createdAt updatedAt deletedAt ${EXTERNAL_IDS}`,
    columns: [
      ["id", "ID"],
      ["name", "NAME"],
      ["cavityCount", "CAVITIES"],
      ["externalIds", "OUTSIDE IDS"],
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
  {
    plural: "productionRuns",
    singular: "productionRun",
    command: "production-runs",
    description: "Runs on stations' lineups: one job at one station",
    fields:
      "id status rank stationId jobId startBy endBy plannedStart plannedEnd runStartedAt closedAt " +
      `closeReason createdAt updatedAt ${EXTERNAL_IDS} station { id name } job { id name } ` +
      "parts { requiredGood product { id sku } }",
    columns: [
      ["id", "ID"],
      ["status", "STATUS"],
      ["station", "STATION"],
      ["job", "JOB"],
      ["externalIds", "OUTSIDE IDS"],
    ],
    next: (run) => [
      { action: "Show the station's lineup", cmd: `rw lineup show ${run.stationId}` },
      { action: "Show the job", cmd: `rw jobs show ${run.jobId}` },
    ],
  },
];

/** A kind's command group: `rw <group> list`. */
export const groupOf = (kind: RecordKind): string => kind.command ?? kind.plural;

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

export const UPSERT_WORKCENTERS =
  "mutation UpsertWorkcenters($source: String, $workcenters: [WorkcenterInput!]!) { " +
  `upsertWorkcenters(source: $source, workcenters: $workcenters) { results { action externalId workcenter { id name } } ${UPSERT_ERRORS} } }`;

export const UPSERT_STATIONS =
  "mutation UpsertStations($source: String, $stations: [StationInput!]!) { " +
  `upsertStations(source: $source, stations: $stations) { results { action externalId station { id name } } ${UPSERT_ERRORS} } }`;

export const UPSERT_TOOLS =
  "mutation UpsertTools($source: String, $tools: [ToolInput!]!) { " +
  `upsertTools(source: $source, tools: $tools) { results { action externalId tool { id name } } ${UPSERT_ERRORS} } }`;

export const UPSERT_JOBS =
  "mutation UpsertJobs($source: String, $jobs: [JobInput!]!) { " +
  `upsertJobs(source: $source, jobs: $jobs) { results { action externalId job { id name } } ${UPSERT_ERRORS} } }`;

export const UPSERT_CUSTOMERS =
  "mutation UpsertCustomers($source: String, $customers: [CustomerUpsertInput!]!) { " +
  `upsertCustomers(source: $source, customers: $customers) { results { action externalId customer { id name } } ${UPSERT_ERRORS} } }`;

export const UPSERT_PRODUCTION_RUNS =
  "mutation UpsertProductionRuns($source: String, $runs: [ProductionRunInput!]!) { " +
  `upsertProductionRuns(source: $source, runs: $runs) { results { action externalId run { id status stationId station { name } job { name } } } ${UPSERT_ERRORS} } }`;

export const SEQUENCE_LINEUP =
  "mutation SequenceLineup($source: String, $station: String!, $runs: [String!]!) { " +
  `sequenceLineup(source: $source, station: $station, runs: $runs) { action station { id name } ${UPSERT_ERRORS} } }`;

export const STATION_LINEUP =
  "query StationLineup($id: ID!) { station(id: $id) { id name lineup { position predictedStart predictedEnd " +
  `startByAtRisk endByAtRisk run { id status ${EXTERNAL_IDS} job { id name } } } } }`;

// Custom entities: the plant's own kinds of record, in one general shape.
const ENTITY_MODEL_FIELDS =
  "id key label description version createdAt updatedAt " +
  "fields { key label description type isList required refModel options { value label } }";
const ENTITY_RECORD_FIELDS = `id model name values deleted createdAt updatedAt ${EXTERNAL_IDS}`;

export const ENTITY_MODELS = `query EntityModels { entityModels { ${ENTITY_MODEL_FIELDS} } }`;

export const ENTITY_MODEL = `query EntityModel($key: String!) { entityModel(key: $key) { ${ENTITY_MODEL_FIELDS} } }`;

export const ENTITY_RECORDS =
  "query EntityRecords($model: String!, $first: Int, $after: String, $updatedSince: DateTime, $includeDeleted: Boolean) { " +
  "entityRecords(model: $model, first: $first, after: $after, updatedSince: $updatedSince, includeDeleted: $includeDeleted) " +
  `{ nodes { ${ENTITY_RECORD_FIELDS} } pageInfo { endCursor hasNextPage } } }`;

export const ENTITY_RECORD = `query EntityRecord($id: ID!) { entityRecord(id: $id) { ${ENTITY_RECORD_FIELDS} } }`;

export const UPSERT_ENTITY_MODELS =
  "mutation UpsertEntityModels($models: [EntityModelInput!]!) { " +
  `upsertEntityModels(models: $models) { results { action key model { id label version } } ${UPSERT_ERRORS} } }`;

export const UPSERT_ENTITY_RECORDS =
  "mutation UpsertEntityRecords($source: String, $model: String!, $records: [EntityRecordInput!]!) { " +
  `upsertEntityRecords(source: $source, model: $model, records: $records) { results { action externalId record { id name } } ${UPSERT_ERRORS} } }`;

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

export const ROTATE_WEBHOOK_SECRET = `mutation RotateWebhookSecret($id: ID!) { rotateWebhookSecret(id: $id) { secret webhook { ${WEBHOOK} } } }`;

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
  UPSERT_WORKCENTERS,
  UPSERT_STATIONS,
  UPSERT_TOOLS,
  UPSERT_JOBS,
  UPSERT_CUSTOMERS,
  UPSERT_PRODUCTION_RUNS,
  SEQUENCE_LINEUP,
  STATION_LINEUP,
  ENTITY_MODELS,
  ENTITY_MODEL,
  ENTITY_RECORDS,
  ENTITY_RECORD,
  UPSERT_ENTITY_MODELS,
  UPSERT_ENTITY_RECORDS,
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
