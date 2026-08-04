If you have a .rds file containing a STAVE object, here is how you can convert the three tables that object contains into an expanded version of the studies table, with one row per survey per variant (101,619 rows at time of writing).

Most of the work and logic is actually done by the two packages STAVE and variantstring, particularly STAVE's `$get_prevalence` function.

Open e.g. an R REPL.

First, install the STAVE, variantstring, and arrow packages.

```R
# load the packages
library(arrow)
library(dplyr)
library(tidyr)
library(STAVE)
library(variantstring)
current_stave_release <- "2026.03.17"
data_root_dir <- "/home/dmears/projects/mrc-ide/PARAmap/paramap-api/data"
input_dir <- file.path(data_root_dir, "input", "stave", current_stave_release)
output_dir <-  file.path(data_root_dir, "stave", current_stave_release)

# Read the WHO target markers csv and construct a list of
# single-locus variantstrings for the targets.
target_markers <- read.csv(file.path(input_dir, "WHO_target_markers.csv"), comment.char = "#")
WHO_variants <- target_markers |>
  pivot_longer(cols = c(ref_aa, alt_aa), names_to = "allele_type", values_to = "aa") |>
  mutate(variant_string = sprintf("%s:%s:%s", vs_gene, position, aa)) |>
  pull(variant_string)
# Validate WHO variants are valid variantstrings
check_variant_string(WHO_variants)


# Extract the STAVE data from the .rds file.
stave_obj <- readRDS(file.path(input_dir, "stave_data_2026.03.17.rds"))

# Prevalence must be calculated without any non-target markers having been dropped
# from the original stave_obj, since prevalence calculations of target markers
# depend on non-target markers.
# But we can still at least skip calculating and storing prevalence for non-target markers.
stave_variants <- stave_obj$get_variants()

# Get variants in common: only WHO target variants are in scope.
variants <- intersect(WHO_variants, stave_variants)

# Iterate over each in-scope variant, calculate imputed prevalence per survey
# (only surveys with a non-zero denominator), and combine into one tibble.
prevalence_tbl <- variants |>
  lapply(function(v) {
    stave_obj$get_prevalence(target_variant = v, return_full = FALSE) |>
      mutate(variant = v)
  }) |>
  bind_rows()

# Parse gene/locus/aa from each variant string using variantstring's own parser.
# Since `variants` comes from get_variants(), the variant strings are guaranteed to be single-locus,
# that is, to have only a single value between each colon.
# If they aren't, `variant_to_long` will unpack the strings into multiple variants, and
# we'll catch this and abort.

parsed_list <- variant_to_long(prevalence_tbl$variant)  # list of data.frames, one per input string

n_rows <- vapply(parsed_list, nrow, integer(1))
if (any(n_rows != 1)) {
  bad <- prevalence_tbl$variant[n_rows != 1]
  stop(sprintf(
    "Expected each variant to parse to exactly 1 row via variant_to_long(), but got unexpected row counts for: %s. The variant string is probably not single-locus. You may have called get_variants(report_haplo=TRUE)",
    paste(unique(bad), collapse = ", ")
  ))
}

parsed <- bind_rows(parsed_list)

prevalence_tbl <- prevalence_tbl |>
  mutate(
    gene     = parsed$gene,
    mutation = paste0(parsed$pos, parsed$aa)
  )

# Because of encoding errors in paper titles, we need to force conversion to UTF-8.
# (The error (from DuckDB) was: Invalid Input Error: Invalid string encoding found in Parquet file: value "Temporal Trends in Artemisinin Partial Resistance and Other Antimalarial Drug Mutations in Plasmodium falciparum from Kagera Region, Northwestern Tanzania, 2021\xD02023" is not valid UTF8!)

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
  mutate(across(where(is.character), fix_utf8))

write_parquet(prevalence_tbl, file.path(output_dir, "prevalence_per_survey.parquet"))
```

Still todo:

3) lat, lng -> admin1, admin0 (via grout - using shapefiles). Probably best to map surveys rather than the 300,000-odd rows in the prevalence_per_survey table.
4) Do any nice index-like features, e.g. sorting or 'partitioning' - especially if table is very large!
