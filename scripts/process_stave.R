# Converts an .rds file containing a STAVE object of 3 tables (studies, surveys, counts)
# into an expanded version of the studies table, having one row per survey per variant,
# which is saved in parquet format.
# This results in a table of about 253,000 rows at time of writing.
# Most of the work and logic is done by the two packages STAVE and variantstring,
# particularly STAVE's `$get_prevalence` function.

library(arrow)
library(cli)
library(dplyr)
library(tidyr)
library(STAVE)
library(variantstring)
library(here)

args <- commandArgs(trailingOnly = TRUE)
if (length(args) == 0) {
  cli_abort(c(
    "Usage: {.code Rscript process_stave.R <stave_release>}",
    "i" = "Example: {.code Rscript process_stave.R 2026.03.17}"
  ))
}

current_stave_release <- args[[1]]
output_filename = "survey_data.parquet"

input_dir <- here("scripts", "input", "stave", current_stave_release)
output_dir <- here("data", "stave", current_stave_release)

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

input_file <- file.path(input_dir, "stave_data.rds")
if (!file.exists(input_file)) {
  cli_abort("Input file not found: {.file {input_file}}.")
}

stave_obj <- readRDS(input_file)

variants <- stave_obj$get_variants()

# For each variant, calculate imputed prevalence per survey
# (only surveys with a non-zero denominator), and combine into one tibble.
prevalence_tbl <- variants |>
  lapply(function(v) {
    stave_obj$get_prevalence(target_variant = v, return_full = FALSE) |>
      mutate(variant = v)
  }) |>
  bind_rows()

# Parse gene/locus/amino-acid from each variant string using variantstring's own parser.
# We validate that all variant strings define a single variant.
# If they do, they have only a single value between each colon.
# If they don't, `variant_to_long` will unpack the strings into multiple variants, and
# we'll catch this and abort.
parsed_list <- variant_to_long(variants)  # one data.frame per variant
n_rows <- vapply(parsed_list, nrow, integer(1))
if (any(n_rows != 1)) {
  bad <- variants[n_rows != 1]
  cli_abort(c(
    "Expected each variant to parse to exactly 1 row via {.fn variant_to_long}, but got unexpected row counts for: {.val {unique(bad)}}.",
    "x" = "The variant string might not be single-locus.",
    "i" = "Did you call {.code $get_variants(report_haplo = TRUE)}?"
  ))
}

parsed <- bind_rows(Map(function(df, v) mutate(df, variant = v), parsed_list, variants))

prevalence_tbl <- prevalence_tbl |>
  left_join(
    parsed |>
      transmute(variant, gene, mutation = paste0(pos, aa)),
    by = "variant"
  )

# Because of encoding errors in paper titles, we need to force conversion to UTF-8.
# This function tries UTF-8 first, and if invalid, assumes Latin-1
fix_utf8 <- function(x) {
  bad <- !validEnc(x) | is.na(iconv(x, "UTF-8", "UTF-8")) # get vector of whether utf-8 encoding works for the string
  x[bad] <- iconv(x[bad], from = "latin1", to = "UTF-8") # For just the flagged entries, reinterpret the raw bytes as Latin-1 and convert to utf-8
  enc2utf8(x) # tag every string as declared-UTF-8
}

# Drop columns we don't need
drop_cols <- c("description", "access_level", "PMID", "country_name",
               "location_method", "location_notes", "time_method", "time_notes")

prevalence_tbl <- prevalence_tbl |>
  select(-all_of(drop_cols)) |>
  rename(lat = latitude, lng = longitude) |>
  mutate(lat = round(lat, 4), lng = round(lng, 4)) |> # Drop <10m precision
  mutate(across(where(is.character), fix_utf8))

write_parquet(prevalence_tbl, file.path(output_dir, output_filename))

cli_inform(c("v" = "Wrote {.file {output_filename}} with {nrow(prevalence_tbl)} rows to {.path {output_dir}}."))
