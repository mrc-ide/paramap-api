# This script generates example model output data for
# testing and development purposes.
# It creates Parquet files for admin0, admin1, and admin2 levels with
# simulated prevalence data for a set of genetic variants over time.
# Once we have real model outputs, we can remove this script
# and use the real data instead.

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
  invalid_variants <- variants[n_rows != 1]
  cli_abort(c(
    "Expected each variant to parse to exactly 1 row via {.fn variant_to_long}, but got unexpected row counts for: {.val {unique(invalid_variants)}}.",
    "x" = "The variant string might not be single-locus."
  ))
}

parsed_variants <- bind_rows(Map(
  function(parsed_variant, variant) mutate(parsed_variant, variant = variant),
  parsed_list,
  variants
)) |>
  transmute(variant, gene, mutation = paste0(pos, aa))

fetch_json <- function(url) {
  response_text <- tryCatch(readLines(url, warn = FALSE), error = function(e) NULL)
  if (is.null(response_text)) {
    cli_abort("Could not read endpoint: {.url {url}}.")
  }
  fromJSON(paste(response_text, collapse = "\n"), simplifyDataFrame = TRUE)
}

extract_data <- function(response, url) {
  if (!is.list(response) || is.null(response$data)) {
    cli_abort("Unexpected response structure from {.url {url}}.")
  }
  response$data
}

admin0_url <- "https://mrcdata.dide.ic.ac.uk/grout/region-metadata/gadm41/admin0"
admin0_resp <- fetch_json(admin0_url)
admin0_df <- extract_data(admin0_resp, admin0_url)

subsaharan_africa_iso <- c(
  "AGO", "BDI", "BEN", "BFA", "BWA", "CAF", "CIV", "CMR", "COD", "COG",
  "COM", "CPV", "DJI", "ERI", "ETH", "GAB", "GHA", "GIN", "GMB", "GNB",
  "GNQ", "KEN", "LBR", "LSO", "MDG", "MLI", "MOZ", "MRT", "MUS", "MWI",
  "NAM", "NER", "NGA", "RWA", "SDN", "SEN", "SLE", "SOM", "SSD", "STP",
  "SWZ", "SYC", "TCD", "TGO", "TZA", "UGA", "ZAF", "ZMB", "ZWE"
)

admin0_regions <- admin0_df |>
  filter(id %in% subsaharan_africa_iso) |>
  transmute(admin0 = id)

fetch_country_level <- function(level, iso3_code) {
  url <- sprintf("https://mrcdata.dide.ic.ac.uk/grout/region-metadata/gadm41/admin%d/%s", level, iso3_code)
  response <- fetch_json(url)
  region_data <- extract_data(response, url)
  if (!is.data.frame(region_data) || nrow(region_data) == 0) {
    return(tibble())
  }
  if (level == 1) {
    return(tibble(admin0 = iso3_code, admin1 = region_data$id))
  }
  if (level == 2) {
    admin1_from_admin2 <- sub("_[0-9]+$", "", region_data$id)
    return(tibble(admin0 = iso3_code, admin1 = admin1_from_admin2, admin2 = region_data$id))
  }
  cli_abort("Unsupported admin level: {level}.")
}

admin1_regions <- map_dfr(subsaharan_africa_iso, ~fetch_country_level(1, .x)) |> distinct(admin0, admin1)
admin2_regions <- map_dfr(subsaharan_africa_iso, ~fetch_country_level(2, .x)) |> distinct(admin0, admin1, admin2)

if (nrow(admin1_regions) == 0 || nrow(admin2_regions) == 0) {
  cli_abort("Failed to collect admin1/admin2 regions from grout endpoint.")
}

make_variant_months <- function(variant_values) {
  # Force a subset of variants to span the full historical range so the
  # generated example data always includes older start dates in meaningful volume.
  n_forced <- max(1L, ceiling(length(variant_values) / 4))
  forced_variants <- variant_values[seq_len(n_forced)]

  forced_extremes <- purrr::map_dfr(forced_variants, function(variant) {
    tibble(
      variant = variant,
      date = seq.Date(as.Date("1970-01-01"), as.Date("2030-12-01"), by = "month")
    )
  })

  sampled <- purrr::map_dfr(variant_values, function(variant) {
    start_year <- sample(1970:2029, size = 1, prob = dnorm(1970:2029, mean = 2005, sd = 9))
    end_year <- sample(start_year:2030, size = 1, prob = dnorm(start_year:2030, mean = 2026, sd = 4))
    start_month <- sample(1:12, size = 1)
    end_month <- sample(1:12, size = 1)

    start_date <- as.Date(sprintf("%04d-%02d-01", start_year, start_month))
    end_date <- as.Date(sprintf("%04d-%02d-01", end_year, end_month))
    if (end_date < start_date) {
      end_date <- as.Date(sprintf("%04d-%02d-01", start_year, min(12, start_month + sample(1:6, 1))))
    }
    months <- seq.Date(start_date, end_date, by = "month")
    tibble(variant = variant, date = months)
  })

  bind_rows(sampled, forced_extremes) |> distinct(variant, date)
}

variant_months <- make_variant_months(variants)

build_level_chunk <- function(level, regions_tbl) {
  base <- tidyr::crossing(
    regions_tbl,
    variant = variants
  ) |>
    # Each variant is duplicated on both sides (once per region on the left,
    # once per month on the right), so this fan-out join is intentional.
    left_join(variant_months, by = "variant", relationship = "many-to-many") |>
    left_join(parsed_variants, by = "variant")

  row_count <- nrow(base)

  mean_prevalence <- rbeta(row_count, shape1 = 2.5, shape2 = 5.5)
  prevalence_sd <- pmax(0.003, pmin(0.18, rnorm(row_count, mean = 0.045, sd = 0.02)))
  median_prevalence <- pmin(1, pmax(0, mean_prevalence + rnorm(row_count, 0, prevalence_sd / 3)))
  lower_95 <- pmax(0, mean_prevalence - 1.96 * prevalence_sd)
  upper_95 <- pmin(1, mean_prevalence + 1.96 * prevalence_sd)

  output_table <- base |>
    mutate(
      mean = mean_prevalence,
      median = median_prevalence,
      SD = prevalence_sd,
      lower_95 = lower_95,
      upper_95 = upper_95,
      exceedance_1 = 1 - pnorm(0.01, mean = mean, sd = SD),
      exceedance_2 = 1 - pnorm(0.02, mean = mean, sd = SD),
      exceedance_5 = 1 - pnorm(0.05, mean = mean, sd = SD),
      exceedance_10 = 1 - pnorm(0.10, mean = mean, sd = SD),
      no_of_informing_surveys = sample.int(35, n(), replace = TRUE) - 1L,
      nearest_survey_by_date = sample(survey_ids, n(), replace = TRUE),
      admin_level = as.integer(level)
    ) |>
    mutate(across(starts_with("exceedance_"), ~pmin(1, pmax(0, .x)))) |>
    select(
      variant,
      gene,
      mutation,
      starts_with("admin"),
      date,
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
      nearest_survey_by_date
    )
}

write_level_table <- function(level, regions_tbl, target_chunk_rows = 500000L) {
  output_path <- file.path(output_dir, sprintf("admin%d.parquet", level))
  temporary_path <- paste0(output_path, ".tmp")
  if (file.exists(temporary_path)) {
    unlink(temporary_path)
  }

  # Limit each expanded table to roughly target_chunk_rows before writing it
  # as one or more row groups to the same Parquet file.
  regions_per_chunk <- max(1L, floor(target_chunk_rows / nrow(variant_months)))
  chunk_ids <- ceiling(seq_len(nrow(regions_tbl)) / regions_per_chunk)
  region_chunks <- split(seq_len(nrow(regions_tbl)), chunk_ids)

  output_stream <- NULL
  writer <- NULL
  total_rows <- 0

  on.exit({
    if (!is.null(writer)) {
      writer$Close()
    }
    if (!is.null(output_stream)) {
      output_stream$close()
    }
    if (file.exists(temporary_path)) {
      unlink(temporary_path)
    }
  }, add = TRUE)

  for (region_indices in region_chunks) {
    output_table <- build_level_chunk(level, regions_tbl[region_indices, , drop = FALSE])
    arrow_table_chunk <- arrow_table(output_table)

    if (is.null(writer)) {
      output_stream <- FileOutputStream$create(temporary_path)
      properties <- ParquetWriterProperties$create(names(output_table))
      writer <- ParquetFileWriter$create(
        arrow_table_chunk$schema,
        output_stream,
        properties = properties
      )
    }

    writer$WriteTable(arrow_table_chunk, chunk_size = min(100000L, nrow(output_table)))
    total_rows <- total_rows + nrow(output_table)
  }

  writer$Close()
  writer <- NULL
  output_stream$close()
  output_stream <- NULL

  if (!file.rename(temporary_path, output_path)) {
    cli_abort("Failed to move completed output to {.file {output_path}}.")
  }

  total_rows
}

admin0_rows <- write_level_table(0, admin0_regions)
admin1_rows <- write_level_table(1, admin1_regions)
admin2_rows <- write_level_table(2, admin2_regions)

cli_inform(c(
  "v" = "Wrote {.file admin0.parquet} with {admin0_rows} rows.",
  "v" = "Wrote {.file admin1.parquet} with {admin1_rows} rows.",
  "v" = "Wrote {.file admin2.parquet} with {admin2_rows} rows.",
  "i" = "Output directory: {.path {output_dir}}."
))
