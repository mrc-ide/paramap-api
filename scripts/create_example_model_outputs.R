library(arrow)
library(cli)
library(dplyr)
library(here)
library(jsonlite)
library(purrr)
library(tidyr)
library(variantstring)

set.seed(20260508)

output_dir <- here("data", "model", "2026.05.08")
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

stave_file <- here("scripts", "input", "stave", "2026.03.17", "stave_data.rds")
if (!file.exists(stave_file)) {
  cli_abort("Input file not found: {.file {stave_file}}.")
}

stave_obj <- readRDS(stave_file)
survey_ids <- stave_obj$get_surveys() |>
  pull(survey_id) |>
  unique()

if (length(survey_ids) == 0) {
  cli_abort("No survey IDs found in {.file {stave_file}}.")
}

variants <- c(
  "crt:76:K",
  "crt:76:T",
  "k13:441:L",
  "k13:441:P",
  "k13:446:F",
  "k13:446:I",
  "k13:458:N",
  "k13:469:C",
  "k13:469:F",
  "k13:469:Y",
  "k13:476:I",
  "k13:476:M",
  "k13:493:H",
  "k13:493:Y",
  "k13:537:N",
  "k13:538:G",
  "k13:539:R",
  "k13:539:T",
  "k13:543:I",
  "k13:553:L",
  "k13:553:P",
  "k13:561:H",
  "k13:561:R",
  "k13:568:G",
  "k13:568:V",
  "k13:574:L",
  "k13:574:P",
  "k13:580:C",
  "k13:580:Y",
  "k13:622:I",
  "k13:622:R",
  "k13:675:A",
  "k13:675:V",
  "mdr1:86:N",
  "mdr1:86:Y"
)

parsed_list <- variant_to_long(variants)
n_rows <- vapply(parsed_list, nrow, integer(1))
if (any(n_rows != 1)) {
  bad <- variants[n_rows != 1]
  cli_abort(c(
    "Expected each variant to parse to exactly 1 row via {.fn variant_to_long}, but got unexpected row counts for: {.val {unique(bad)}}.",
    "x" = "The variant string might not be single-locus."
  ))
}

parsed_variants <- bind_rows(Map(function(df, v) mutate(df, variant = v), parsed_list, variants)) |>
  transmute(variant, gene, mutation = paste0(pos, aa))

fetch_json <- function(url) {
  txt <- tryCatch(readLines(url, warn = FALSE), error = function(e) NULL)
  if (is.null(txt)) {
    cli_abort("Could not read endpoint: {.url {url}}.")
  }
  fromJSON(paste(txt, collapse = "\n"), simplifyDataFrame = TRUE)
}

extract_data <- function(resp, url) {
  if (!is.list(resp) || is.null(resp$data)) {
    cli_abort("Unexpected response structure from {.url {url}}.")
  }
  resp$data
}

admin0_url <- "https://mrcdata.dide.ic.ac.uk/grout/region-metadata/gadm41/admin0"
admin0_resp <- fetch_json(admin0_url)
admin0_df <- extract_data(admin0_resp, admin0_url)

ssa_iso <- c(
  "AGO", "BDI", "BEN", "BFA", "BWA", "CAF", "CIV", "CMR", "COD", "COG",
  "COM", "CPV", "DJI", "ERI", "ETH", "GAB", "GHA", "GIN", "GMB", "GNB",
  "GNQ", "KEN", "LBR", "LSO", "MDG", "MLI", "MOZ", "MRT", "MUS", "MWI",
  "NAM", "NER", "NGA", "RWA", "SDN", "SEN", "SLE", "SOM", "SSD", "STP",
  "SWZ", "SYC", "TCD", "TGO", "TZA", "UGA", "ZAF", "ZMB", "ZWE"
)

admin0_regions <- admin0_df |>
  filter(id %in% ssa_iso) |>
  transmute(region_id = id)

if (nrow(admin0_regions) == 0) {
  cli_abort("No sub-Saharan African admin0 regions found from grout.")
}

fetch_country_level <- function(level, iso) {
  url <- sprintf("https://mrcdata.dide.ic.ac.uk/grout/region-metadata/gadm41/admin%d/%s", level, iso)
  resp <- fetch_json(url)
  dat <- extract_data(resp, url)
  if (!is.data.frame(dat) || nrow(dat) == 0) {
    return(tibble(region_id = character(0)))
  }
  tibble(region_id = dat$id)
}

admin1_regions <- map_dfr(ssa_iso, ~fetch_country_level(1, .x)) |> distinct(region_id)
admin2_regions <- map_dfr(ssa_iso, ~fetch_country_level(2, .x)) |> distinct(region_id)

if (nrow(admin1_regions) == 0 || nrow(admin2_regions) == 0) {
  cli_abort("Failed to collect admin1/admin2 regions from grout endpoint.")
}

make_variant_months <- function(variant_values) {
  purrr::map_dfr(variant_values, function(v) {
    start_year <- sample(1990:2029, size = 1, prob = dnorm(1990:2029, mean = 2020, sd = 9))
    end_year <- sample(start_year:2030, size = 1, prob = dnorm(start_year:2030, mean = 2026, sd = 4))
    start_month <- sample(1:12, size = 1)
    end_month <- sample(1:12, size = 1)

    start_date <- as.Date(sprintf("%04d-%02d-01", start_year, start_month))
    end_date <- as.Date(sprintf("%04d-%02d-01", end_year, end_month))
    if (end_date < start_date) {
      end_date <- as.Date(sprintf("%04d-%02d-01", start_year, min(12, start_month + sample(1:6, 1))))
    }
    months <- seq.Date(start_date, end_date, by = "month")
    tibble(variant = v, time = months)
  })
}

variant_months <- make_variant_months(variants)

build_level_table <- function(level, regions_tbl) {
  base <- tidyr::crossing(
    region_id = regions_tbl$region_id,
    variant = variants
  ) |>
    # Each variant is duplicated on both sides (once per region on the left,
    # once per month on the right), so this fan-out join is intentional.
    left_join(variant_months, by = "variant", relationship = "many-to-many") |>
    left_join(parsed_variants, by = "variant")

  n <- nrow(base)

  mean_val <- rbeta(n, shape1 = 2.5, shape2 = 5.5)
  sd_val <- pmax(0.003, pmin(0.18, rnorm(n, mean = 0.045, sd = 0.02)))
  median_val <- pmin(1, pmax(0, mean_val + rnorm(n, 0, sd_val / 3)))
  lower_95 <- pmax(0, mean_val - 1.96 * sd_val)
  upper_95 <- pmin(1, mean_val + 1.96 * sd_val)

  out <- base |>
    mutate(
      mean = mean_val,
      median = median_val,
      SD = sd_val,
      lower_95 = lower_95,
      upper_95 = upper_95,
      exceedance_1 = 1 - pnorm(0.01, mean = mean, sd = SD),
      exceedance_2 = 1 - pnorm(0.02, mean = mean, sd = SD),
      exceedance_5 = 1 - pnorm(0.05, mean = mean, sd = SD),
      exceedance_10 = 1 - pnorm(0.10, mean = mean, sd = SD),
      no_of_informing_surveys = sample.int(35, n(), replace = TRUE) - 1L,
      nearest_survey_by_time = sample(survey_ids, n(), replace = TRUE),
      admin_level = level
    ) |>
    mutate(across(starts_with("exceedance_"), ~pmin(1, pmax(0, .x)))) |>
    select(
      variant,
      gene,
      mutation,
      region_id,
      time,
      mean,
      median,
      SD,
      lower_95,
      upper_95,
      exceedance_1,
      exceedance_2,
      exceedance_5,
      exceedance_10,
      no_of_informing_surveys,
      nearest_survey_by_time
    )

  write_parquet(out, file.path(output_dir, sprintf("admin%d.parquet", level)))
  out
}

admin0_out <- build_level_table(0, admin0_regions)
admin1_out <- build_level_table(1, admin1_regions)
admin2_out <- build_level_table(2, admin2_regions)

cli_inform(c(
  "v" = "Wrote {.file admin0.parquet} with {nrow(admin0_out)} rows.",
  "v" = "Wrote {.file admin1.parquet} with {nrow(admin1_out)} rows.",
  "v" = "Wrote {.file admin2.parquet} with {nrow(admin2_out)} rows.",
  "i" = "Output directory: {.path {output_dir}}."
))
