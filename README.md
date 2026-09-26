# Dev/Running #

## Dependencies ##
npm install next@^16.3.6 react@^19.3.0 react-dom@^19.3.0
npm install --save-dev typescript@^7.0.2 @types/node@^26.6.3 @types/react@^19.3.0 @types/react-dom@^19.3.0
npm install
npm i postgres
npm i maplibre-gl


## Run ##
npm run dev





# Database Tables #

## incident_types
The 5 hazard categories and their timing rules.

| Column | Type |
|---|---|
| incident_type | text (PK) |
| label | text |
| severity | int |
| window_minutes | int |
| ttl_minutes | int |

## reporters
Each phone/user that has submitted a report.

| Column | Type |
|---|---|
| reporter_id | text (PK) |
| created_at | timestamptz |

## roads
Google road segments we've already looked up (the cache).

| Column | Type |
|---|---|
| place_id | text (PK) |
| name | text |

## reports (hypertable, 1-day chunks)
Every raw classified report, one row each.

| Column | Type |
|---|---|
| time | timestamptz (PK) |
| id | uuid (PK) |
| incident_type | text → incident_types |
| reporter_id | text → reporters |
| geom | geometry(Point, 4326) |
| road_place_id | text → roads (nullable) |
| transcript | text |

## incidents
Confirmed hazards (5+ reports) that show live on the map until they expire.

| Column | Type |
|---|---|
| id | bigserial (PK) |
| road_place_id | text → roads |
| incident_type | text → incident_types |
| first_reported | timestamptz |
| expires_at | timestamptz |
| report_count | int |
| lat | double precision |
| lon | double precision |

## report_heat (continuous aggregate, auto-updated)
Report counts per hour, per road, per type — feeds the heat map. Never write to it directly.

| Column | Type |
|---|---|
| bucket | timestamptz |
| road_place_id | text |
| incident_type | text |
| n | bigint |
| lat | double precision |
| lon | double precision |