#include "../shared/anime_engine.hpp"
#include "../shared/schema.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define ANIME_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define ANIME_EXPORT
#endif

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace {

std::string_view trim_ascii(std::string_view value) noexcept {
  while (!value.empty()) {
    const unsigned char c = static_cast<unsigned char>(value.front());
    if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
    value.remove_prefix(1);
  }
  while (!value.empty()) {
    const unsigned char c = static_cast<unsigned char>(value.back());
    if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
    value.remove_suffix(1);
  }
  return value;
}

std::optional<double> parse_number(std::string_view value) noexcept {
  value = trim_ascii(value);
  if (value.empty()) return std::nullopt;
  std::string buffer(value);
  char* end = nullptr;
  errno = 0;
  const double parsed = std::strtod(buffer.c_str(), &end);
  if (errno != 0 || end == buffer.c_str() || *end != '\0' || !std::isfinite(parsed)) return std::nullopt;
  return parsed;
}

bool number_in_range(std::string_view value, std::string_view minimum, std::string_view maximum) noexcept {
  const auto parsed = parse_number(value);
  if (!parsed) return false;
  const auto min_value = parse_number(minimum);
  const auto max_value = parse_number(maximum);
  if (!trim_ascii(minimum).empty() && !min_value) return false;
  if (!trim_ascii(maximum).empty() && !max_value) return false;
  if (min_value && *parsed < *min_value) return false;
  if (max_value && *parsed > *max_value) return false;
  return true;
}

bool valid_date_bound(std::string_view value) noexcept {
  value = trim_ascii(value);
  if (value.empty()) return true;
  if (value.size() != 4 && value.size() != 7 && value.size() != 10) return false;
  for (std::size_t i = 0; i < value.size(); ++i) {
    if (i == 4 || i == 7) {
      if (value[i] != '-') return false;
    } else if (value[i] < '0' || value[i] > '9') {
      return false;
    }
  }
  if (value.size() >= 7) {
    const int month = (value[5] - '0') * 10 + (value[6] - '0');
    if (month < 1 || month > 12) return false;
  }
  if (value.size() == 10) {
    const int day = (value[8] - '0') * 10 + (value[9] - '0');
    if (day < 1 || day > 31) return false;
  }
  return true;
}

bool date_in_range(std::string_view value, std::string_view minimum, std::string_view maximum) noexcept {
  value = trim_ascii(value);
  minimum = trim_ascii(minimum);
  maximum = trim_ascii(maximum);
  if (value.empty()) return false;
  if (!minimum.empty() && value < minimum) return false;
  if (!maximum.empty() && value > maximum) return false;
  return true;
}

bool structured_date_in_range(std::string_view value,
                              std::size_t target_field,
                              std::string_view minimum,
                              std::string_view maximum) noexcept {
  std::size_t field_index = 0;
  std::size_t field_start = 0;
  bool escaped = false;

  auto check_field = [&](std::size_t end) {
    if (field_index != target_field || end < field_start) return false;
    return date_in_range(value.substr(field_start, end - field_start), minimum, maximum);
  };

  for (std::size_t i = 0; i <= value.size(); ++i) {
    const bool at_end = i == value.size();
    const char c = at_end ? '\0' : value[i];

    if (!at_end && !escaped && c == '\\') {
      escaped = true;
      continue;
    }

    if (!at_end && !escaped && c == ':' && i + 1 < value.size() && value[i + 1] == ':') {
      if (check_field(i)) return true;
      ++field_index;
      i += 1;
      field_start = i + 1;
      continue;
    }

    if (at_end || (!escaped && c == '|')) {
      if (check_field(i)) return true;
      field_index = 0;
      field_start = i + 1;
      escaped = false;
      continue;
    }

    escaped = false;
  }

  return false;
}

class SearchRuntime {
 public:
  int reset() {
    terms_.clear();
    results_.clear();
    scratch_.clear();
    local_error_.clear();
    combine_or_ = false;
    schema_checked_ = false;
    return dataset_.reset() ? 1 : 0;
  }

  int add_csv(const std::uint8_t* data, std::size_t size) {
    if (!dataset_.add_csv(data, size)) return 0;
    if (!schema_checked_) {
      std::string schema_error;
      if (!anime::schema::validate_common_schema(dataset_, schema_error)) {
        dataset_.reset();
        local_error_ = std::move(schema_error);
        return 0;
      }
      schema_checked_ = true;
    }
    local_error_.clear();
    return 1;
  }

  int finalize() {
    if (!schema_checked_) {
      local_error_ = "No valid common-schema CSV has been loaded.";
      return 0;
    }
    if (!dataset_.finalize()) return 0;
    local_error_.clear();
    return 1;
  }

  int clear_terms() {
    terms_.clear();
    results_.clear();
    local_error_.clear();
    return 1;
  }

  int set_combine_mode(int mode) {
    if (mode != 0 && mode != 1) {
      local_error_ = "Invalid combine mode.";
      return 0;
    }
    combine_or_ = mode == 1;
    local_error_.clear();
    return 1;
  }

  int add_text_term(const char* value, const char* selector, int match_mode, int negated) {
    if (!dataset_.finalized()) {
      local_error_ = "Finalize the dataset before adding search terms.";
      return 0;
    }
    if (!value) {
      local_error_ = "Search term is null.";
      return 0;
    }
    if (match_mode < 0 || match_mode > 2) {
      local_error_ = "Invalid text match mode.";
      return 0;
    }

    const std::string_view trimmed = trim_ascii(value);
    if (trimmed.empty()) {
      local_error_ = "Search term is empty.";
      return 0;
    }

    const std::string_view selector_name = selector ? trim_ascii(selector) : std::string_view("all");
    std::vector<std::size_t> columns;
    const int exact_column = dataset_.column_index(selector_name);
    if (exact_column >= 0) {
      columns.push_back(static_cast<std::size_t>(exact_column));
    } else {
      columns = dataset_.resolve_group(selector_name.empty() ? std::string_view("all") : selector_name);
    }
    if (columns.empty()) {
      local_error_ = "Search selector has no columns: " + std::string(selector_name);
      return 0;
    }

    Term term;
    term.kind = TermKind::Text;
    term.value.assign(trimmed);
    term.columns = std::move(columns);
    term.match_mode = match_mode;
    term.negated = negated != 0;
    terms_.push_back(std::move(term));
    local_error_.clear();
    return 1;
  }

  int add_number_range(const char* column, const char* minimum, const char* maximum, int negated) {
    if (!dataset_.finalized()) {
      local_error_ = "Finalize the dataset before adding search terms.";
      return 0;
    }
    if (!column || !*column) {
      local_error_ = "Number range column is empty.";
      return 0;
    }
    const int index = dataset_.column_index(column);
    if (index < 0) {
      local_error_ = "Number range column does not exist: " + std::string(column);
      return 0;
    }

    const std::string min_value = minimum ? std::string(trim_ascii(minimum)) : std::string();
    const std::string max_value = maximum ? std::string(trim_ascii(maximum)) : std::string();
    if (min_value.empty() && max_value.empty()) {
      local_error_ = "Number range requires a minimum or maximum.";
      return 0;
    }
    if ((!min_value.empty() && !parse_number(min_value)) || (!max_value.empty() && !parse_number(max_value))) {
      local_error_ = "Number range boundary is invalid.";
      return 0;
    }

    Term term;
    term.kind = TermKind::NumberRange;
    term.minimum = min_value;
    term.maximum = max_value;
    term.columns = {static_cast<std::size_t>(index)};
    term.negated = negated != 0;
    terms_.push_back(std::move(term));
    local_error_.clear();
    return 1;
  }

  int add_date_range(const char* selector, const char* minimum, const char* maximum, int negated) {
    if (!dataset_.finalized()) {
      local_error_ = "Finalize the dataset before adding search terms.";
      return 0;
    }
    if (!selector || !*selector) {
      local_error_ = "Date range selector is empty.";
      return 0;
    }

    const std::string min_value = minimum ? std::string(trim_ascii(minimum)) : std::string();
    const std::string max_value = maximum ? std::string(trim_ascii(maximum)) : std::string();
    if (min_value.empty() && max_value.empty()) {
      local_error_ = "Date range requires a minimum or maximum.";
      return 0;
    }
    if (!valid_date_bound(min_value) || !valid_date_bound(max_value)) {
      local_error_ = "Date range boundary is invalid.";
      return 0;
    }

    Term term;
    term.minimum = min_value;
    term.maximum = max_value;
    term.negated = negated != 0;

    const std::string_view name(selector);
    if (name == "streaming_start" || name == "streaming_end") {
      const int index = dataset_.column_index("streaming_services");
      if (index < 0) {
        local_error_ = "streaming_services column is unavailable.";
        return 0;
      }
      term.kind = TermKind::StructuredDateRange;
      term.columns = {static_cast<std::size_t>(index)};
      term.structured_field = name == "streaming_start" ? 3U : 4U;
    } else if (name == "episode_air_date") {
      const int index = dataset_.column_index("episodes");
      if (index < 0) {
        local_error_ = "episodes column is unavailable.";
        return 0;
      }
      term.kind = TermKind::StructuredDateRange;
      term.columns = {static_cast<std::size_t>(index)};
      term.structured_field = 2U;
    } else {
      const int index = dataset_.column_index(name);
      if (index < 0) {
        local_error_ = "Date range column does not exist: " + std::string(name);
        return 0;
      }
      term.kind = TermKind::DateRange;
      term.columns = {static_cast<std::size_t>(index)};
    }

    terms_.push_back(std::move(term));
    local_error_.clear();
    return 1;
  }

  int execute() {
    if (!dataset_.finalized()) {
      local_error_ = "Finalize the dataset before executing a search.";
      return 0;
    }
    if (terms_.empty()) {
      local_error_ = "At least one search term is required.";
      return 0;
    }

    results_.clear();
    results_.reserve(dataset_.record_count() / 4 + 16);
    for (std::size_t record = 0; record < dataset_.record_count(); ++record) {
      bool accepted = !combine_or_;
      if (combine_or_) {
        accepted = false;
        for (const Term& term : terms_) {
          if (matches_term(record, term)) {
            accepted = true;
            break;
          }
        }
      } else {
        for (const Term& term : terms_) {
          if (!matches_term(record, term)) {
            accepted = false;
            break;
          }
        }
      }
      if (accepted) results_.push_back(static_cast<std::uint32_t>(record));
    }

    if (!dataset_.sort_indices(results_, anime::SortKey::Season, anime::SortDirection::Asc)) {
      local_error_ = "Default search-result sort failed.";
      return 0;
    }
    local_error_.clear();
    return 1;
  }

  int sort(int key, int direction) {
    if (key < 0 || key > 5 || (direction != 0 && direction != 1)) {
      local_error_ = "Invalid sort request.";
      return 0;
    }
    if (!dataset_.sort_indices(results_, static_cast<anime::SortKey>(key), static_cast<anime::SortDirection>(direction))) {
      local_error_ = "Search-result sort failed.";
      return 0;
    }
    local_error_.clear();
    return 1;
  }

  std::size_t count() const noexcept { return results_.size(); }

  const char* chunk_json(std::size_t offset, std::size_t limit) {
    scratch_ = dataset_.cards_json(results_, offset, std::min<std::size_t>(limit, 500));
    return scratch_.c_str();
  }

  const char* record_json_by_id(const char* id) {
    scratch_ = id ? dataset_.record_json_by_id(id) : "null";
    return scratch_.c_str();
  }

  const char* last_error() const noexcept {
    if (!local_error_.empty()) return local_error_.c_str();
    return dataset_.last_error().c_str();
  }

 private:
  enum class TermKind { Text, NumberRange, DateRange, StructuredDateRange };

  struct Term {
    TermKind kind = TermKind::Text;
    std::string value;
    std::string minimum;
    std::string maximum;
    std::vector<std::size_t> columns;
    int match_mode = 2;
    bool negated = false;
    std::size_t structured_field = 0;
  };

  bool matches_term(std::size_t record_index, const Term& term) const {
    bool matched = false;
    if (term.kind == TermKind::Text) {
      for (const std::size_t column : term.columns) {
        const std::string_view value = dataset_.field(record_index, column);
        if (term.match_mode == 0) matched = anime::ascii_iequals(value, term.value);
        else if (term.match_mode == 1) matched = anime::ascii_iprefix(value, term.value);
        else matched = anime::ascii_icontains(value, term.value);
        if (matched) break;
      }
    } else if (term.kind == TermKind::NumberRange) {
      matched = number_in_range(dataset_.field(record_index, term.columns.front()), term.minimum, term.maximum);
    } else if (term.kind == TermKind::DateRange) {
      matched = date_in_range(dataset_.field(record_index, term.columns.front()), term.minimum, term.maximum);
    } else {
      matched = structured_date_in_range(dataset_.field(record_index, term.columns.front()),
                                         term.structured_field,
                                         term.minimum,
                                         term.maximum);
    }
    return term.negated ? !matched : matched;
  }

  anime::Dataset dataset_;
  bool combine_or_ = false;
  bool schema_checked_ = false;
  std::vector<Term> terms_;
  std::vector<std::uint32_t> results_;
  std::string scratch_;
  std::string local_error_;
};

SearchRuntime engine;

}  // namespace

extern "C" {

ANIME_EXPORT int anime_search_reset() { return engine.reset(); }
ANIME_EXPORT int anime_search_add_csv(const std::uint8_t* data, std::size_t size) { return engine.add_csv(data, size); }
ANIME_EXPORT int anime_search_finalize() { return engine.finalize(); }
ANIME_EXPORT int anime_search_clear_terms() { return engine.clear_terms(); }
ANIME_EXPORT int anime_search_set_combine_mode(int mode) { return engine.set_combine_mode(mode); }
ANIME_EXPORT int anime_search_add_text_term(const char* value, const char* selector, int match_mode, int negated) {
  return engine.add_text_term(value, selector, match_mode, negated);
}
ANIME_EXPORT int anime_search_add_number_range(const char* column, const char* minimum, const char* maximum, int negated) {
  return engine.add_number_range(column, minimum, maximum, negated);
}
ANIME_EXPORT int anime_search_add_date_range(const char* selector, const char* minimum, const char* maximum, int negated) {
  return engine.add_date_range(selector, minimum, maximum, negated);
}
ANIME_EXPORT int anime_search_execute() { return engine.execute(); }
ANIME_EXPORT int anime_search_sort(int key, int direction) { return engine.sort(key, direction); }
ANIME_EXPORT std::size_t anime_search_count() { return engine.count(); }
ANIME_EXPORT const char* anime_search_chunk_json(std::size_t offset, std::size_t limit) { return engine.chunk_json(offset, limit); }
ANIME_EXPORT const char* anime_search_record_json_by_id(const char* id) { return engine.record_json_by_id(id); }
ANIME_EXPORT const char* anime_search_last_error() { return engine.last_error(); }

}
