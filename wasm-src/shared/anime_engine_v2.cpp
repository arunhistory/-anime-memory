#include "anime_engine.hpp"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_set>

namespace anime {
namespace {

struct ParsedCsv {
  std::vector<std::string> headers;
  std::vector<char> pool;
  std::vector<FieldRef> cells;
  std::size_t rows = 0;
};

constexpr std::string_view kExpectedHeaders[] = {
    "id", "title_ja", "title_kana", "title_romaji", "title_en", "aliases",
    "media_type", "release_start", "release_end", "episode_count", "runtime_min",
    "series_id", "season_number", "genres", "tags", "target_demographic", "setting",
    "era", "themes", "original_type", "original_title", "original_author", "original_artist",
    "original_publisher", "original_label", "original_magazine", "original_platform",
    "animation_studio", "co_animation_studio", "animation_cooperation", "production_name",
    "production_committee", "production_members", "production_lead_company", "planning",
    "executive_producers", "producers", "animation_producers", "line_producers", "director",
    "chief_director", "series_composition", "character_original_design", "character_design",
    "music", "sound_director", "staff", "characters", "opening_themes", "ending_themes",
    "insert_songs", "music_production", "soundtrack_label", "broadcast_networks",
    "broadcast_slots", "streaming_services", "film_distributor", "theatrical_release_date",
    "relations", "episodes", "episode_staff", "awards", "synopsis", "image_url",
    "official_url", "official_x", "official_youtube", "official_other", "external_ids",
    "updated_at"};

inline unsigned char ascii_fold(unsigned char value) noexcept {
  if (value >= 'A' && value <= 'Z') return static_cast<unsigned char>(value + ('a' - 'A'));
  return value;
}

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

bool valid_utf8(const std::uint8_t* data, std::size_t size) noexcept {
  std::size_t i = 0;
  while (i < size) {
    const std::uint8_t c = data[i];
    if (c <= 0x7F) {
      ++i;
      continue;
    }
    std::size_t extra = 0;
    std::uint32_t codepoint = 0;
    if ((c & 0xE0) == 0xC0) {
      extra = 1;
      codepoint = c & 0x1F;
      if (codepoint == 0) return false;
    } else if ((c & 0xF0) == 0xE0) {
      extra = 2;
      codepoint = c & 0x0F;
    } else if ((c & 0xF8) == 0xF0) {
      extra = 3;
      codepoint = c & 0x07;
    } else {
      return false;
    }
    if (i + extra >= size) return false;
    for (std::size_t j = 1; j <= extra; ++j) {
      const std::uint8_t next = data[i + j];
      if ((next & 0xC0) != 0x80) return false;
      codepoint = (codepoint << 6) | (next & 0x3F);
    }
    if ((extra == 1 && codepoint < 0x80) ||
        (extra == 2 && codepoint < 0x800) ||
        (extra == 3 && codepoint < 0x10000) ||
        codepoint > 0x10FFFF ||
        (codepoint >= 0xD800 && codepoint <= 0xDFFF)) {
      return false;
    }
    i += extra + 1;
  }
  return true;
}

std::string_view field_from(const ParsedCsv& parsed, const FieldRef& ref) noexcept {
  if (static_cast<std::size_t>(ref.offset) + ref.length > parsed.pool.size()) return {};
  return {parsed.pool.data() + ref.offset, ref.length};
}

bool parse_csv(const std::uint8_t* data, std::size_t size, ParsedCsv& out, std::string& error) {
  if (!data && size != 0) {
    error = "CSV pointer is null.";
    return false;
  }
  if (size == 0) {
    error = "CSV is empty.";
    return false;
  }
  if (!valid_utf8(data, size)) {
    error = "CSV is not valid UTF-8.";
    return false;
  }

  std::size_t cursor = 0;
  if (size >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) cursor = 3;

  std::vector<FieldRef> row;
  std::uint32_t field_offset = 0;
  std::size_t row_number = 1;
  bool in_quotes = false;
  bool quote_closed = false;
  bool field_started = false;
  bool row_started = false;
  std::uint32_t expected_columns = 0;

  auto begin_field = [&]() {
    field_offset = static_cast<std::uint32_t>(out.pool.size());
    field_started = false;
    quote_closed = false;
  };

  auto finish_field = [&]() -> bool {
    if (out.pool.size() > std::numeric_limits<std::uint32_t>::max()) {
      error = "CSV exceeds the 32-bit WASM field-address limit.";
      return false;
    }
    const std::size_t length = out.pool.size() - field_offset;
    if (length > std::numeric_limits<std::uint32_t>::max()) {
      error = "CSV field is too large.";
      return false;
    }
    row.push_back(FieldRef{field_offset, static_cast<std::uint32_t>(length)});
    begin_field();
    return true;
  };

  auto finish_row = [&]() -> bool {
    if (out.headers.empty()) {
      if (row.empty()) {
        error = "CSV header is empty.";
        return false;
      }
      std::unordered_set<std::string> seen;
      out.headers.reserve(row.size());
      for (const FieldRef& ref : row) {
        std::string name(field_from(out, ref));
        if (name.empty()) {
          error = "CSV header contains an empty column name.";
          return false;
        }
        if (!seen.emplace(name).second) {
          error = "CSV header contains a duplicate column: " + name;
          return false;
        }
        out.headers.push_back(std::move(name));
      }
      expected_columns = static_cast<std::uint32_t>(out.headers.size());
      out.pool.clear();
      begin_field();
    } else {
      if (row.size() != expected_columns) {
        error = "CSV row " + std::to_string(row_number) + " has " +
                std::to_string(row.size()) + " columns; expected " +
                std::to_string(expected_columns) + ".";
        return false;
      }
      out.cells.insert(out.cells.end(), row.begin(), row.end());
      ++out.rows;
    }
    row.clear();
    row_started = false;
    ++row_number;
    return true;
  };

  begin_field();
  for (std::size_t i = cursor; i < size; ++i) {
    const unsigned char c = data[i];
    if (in_quotes) {
      row_started = true;
      if (c == '"') {
        if (i + 1 < size && data[i + 1] == '"') {
          out.pool.push_back('"');
          ++i;
        } else {
          in_quotes = false;
          quote_closed = true;
        }
      } else {
        out.pool.push_back(static_cast<char>(c));
      }
      continue;
    }

    if (quote_closed) {
      if (c == ',') {
        if (!finish_field()) return false;
        continue;
      }
      if (c == '\r' || c == '\n') {
        if (c == '\r' && i + 1 < size && data[i + 1] == '\n') ++i;
        if (!finish_field() || !finish_row()) return false;
        continue;
      }
      error = "CSV row " + std::to_string(row_number) + " contains characters after a closing quote.";
      return false;
    }

    if (c == '"') {
      if (field_started || out.pool.size() != field_offset) {
        error = "CSV row " + std::to_string(row_number) + " contains a quote inside an unquoted field.";
        return false;
      }
      field_started = true;
      row_started = true;
      in_quotes = true;
      continue;
    }
    if (c == ',') {
      row_started = true;
      if (!finish_field()) return false;
      continue;
    }
    if (c == '\r' || c == '\n') {
      if (c == '\r' && i + 1 < size && data[i + 1] == '\n') ++i;
      if (!finish_field() || !finish_row()) return false;
      continue;
    }
    field_started = true;
    row_started = true;
    out.pool.push_back(static_cast<char>(c));
  }

  if (in_quotes) {
    error = "CSV ended inside a quoted field.";
    return false;
  }
  if (quote_closed || field_started || row_started || !row.empty() || out.pool.size() != field_offset) {
    if (!finish_field() || !finish_row()) return false;
  }
  if (out.headers.empty()) {
    error = "CSV header is missing.";
    return false;
  }
  return true;
}

bool exact_schema(const std::vector<std::string>& headers, std::string& error) {
  constexpr std::size_t expected_count = sizeof(kExpectedHeaders) / sizeof(kExpectedHeaders[0]);
  if (headers.size() != expected_count) {
    error = "CSV schema column count does not match the common schema.";
    return false;
  }
  for (std::size_t i = 0; i < expected_count; ++i) {
    if (headers[i] != kExpectedHeaders[i]) {
      error = "CSV schema mismatch at column " + std::to_string(i + 1) + ": expected " +
              std::string(kExpectedHeaders[i]) + ", got " + headers[i] + ".";
      return false;
    }
  }
  return true;
}

bool valid_internal_id(std::string_view id) noexcept {
  if (id.size() != 9 || id.front() != 'A') return false;
  for (std::size_t i = 1; i < id.size(); ++i) {
    if (id[i] < '0' || id[i] > '9') return false;
  }
  return true;
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

bool digits(std::string_view value) noexcept {
  if (value.empty()) return false;
  for (const char c : value) if (c < '0' || c > '9') return false;
  return true;
}

bool valid_date_precision(std::string_view value) noexcept {
  value = trim_ascii(value);
  if (value.empty()) return true;
  if (value.size() != 4 && value.size() != 7 && value.size() != 10) return false;
  if (!digits(value.substr(0, 4))) return false;
  if (value.size() >= 7) {
    if (value[4] != '-' || !digits(value.substr(5, 2))) return false;
    const int month = (value[5] - '0') * 10 + (value[6] - '0');
    if (month < 1 || month > 12) return false;
  }
  if (value.size() == 10) {
    if (value[7] != '-' || !digits(value.substr(8, 2))) return false;
    const int day = (value[8] - '0') * 10 + (value[9] - '0');
    if (day < 1 || day > 31) return false;
  }
  return true;
}

std::string normalize_date(std::string_view value, bool upper) {
  value = trim_ascii(value);
  if (value.empty()) return {};
  std::string result(value);
  if (value.size() == 4) result += upper ? "-12-31" : "-01-01";
  else if (value.size() == 7) result += upper ? "-31" : "-01";
  return result;
}

int compare_text(std::string_view left, std::string_view right) noexcept {
  const std::size_t common = std::min(left.size(), right.size());
  for (std::size_t i = 0; i < common; ++i) {
    const unsigned char a = ascii_fold(static_cast<unsigned char>(left[i]));
    const unsigned char b = ascii_fold(static_cast<unsigned char>(right[i]));
    if (a < b) return -1;
    if (a > b) return 1;
  }
  if (left.size() < right.size()) return -1;
  if (left.size() > right.size()) return 1;
  return 0;
}

int compare_blank_last(std::string_view left, std::string_view right) noexcept {
  const bool left_empty = trim_ascii(left).empty();
  const bool right_empty = trim_ascii(right).empty();
  if (left_empty != right_empty) return left_empty ? 1 : -1;
  if (left_empty) return 0;
  return compare_text(left, right);
}

int quarter_from_date(std::string_view value) noexcept {
  value = trim_ascii(value);
  if (value.size() < 7 || value[4] != '-') return 5;
  const int month = (value[5] - '0') * 10 + (value[6] - '0');
  if (month < 1 || month > 12) return 5;
  return ((month - 1) / 3) + 1;
}

std::string season_label(std::string_view date) {
  date = trim_ascii(date);
  const int quarter = quarter_from_date(date);
  if (quarter < 1 || quarter > 4) return {};
  std::string result;
  if (date.size() >= 4) result.append(date.substr(0, 4));
  static constexpr const char* labels[] = {"", "冬", "春", "夏", "秋"};
  result += labels[quarter];
  return result;
}

void append_json_string(std::string& output, std::string_view value) {
  output.push_back('"');
  for (const unsigned char c : value) {
    switch (c) {
      case '"': output += "\\\""; break;
      case '\\': output += "\\\\"; break;
      case '\b': output += "\\b"; break;
      case '\f': output += "\\f"; break;
      case '\n': output += "\\n"; break;
      case '\r': output += "\\r"; break;
      case '\t': output += "\\t"; break;
      default:
        if (c < 0x20) {
          static constexpr char hex[] = "0123456789abcdef";
          output += "\\u00";
          output.push_back(hex[(c >> 4) & 0x0F]);
          output.push_back(hex[c & 0x0F]);
        } else {
          output.push_back(static_cast<char>(c));
        }
    }
  }
  output.push_back('"');
}

bool date_in_range(std::string_view value, std::string_view minimum, std::string_view maximum) {
  value = trim_ascii(value);
  if (value.empty() || !valid_date_precision(value)) return false;
  const std::string low_value = normalize_date(value, false);
  const std::string high_value = normalize_date(value, true);
  const std::string minimum_value = normalize_date(minimum, false);
  const std::string maximum_value = normalize_date(maximum, true);
  if (!minimum_value.empty() && high_value < minimum_value) return false;
  if (!maximum_value.empty() && low_value > maximum_value) return false;
  return true;
}

bool number_in_range(std::string_view value, std::string_view minimum, std::string_view maximum) noexcept {
  const auto parsed = parse_number(value);
  if (!parsed) return false;
  const auto min_value = parse_number(minimum);
  const auto max_value = parse_number(maximum);
  if (min_value && *parsed < *min_value) return false;
  if (max_value && *parsed > *max_value) return false;
  return true;
}

SortKey sort_key_from_int(int value) noexcept {
  if (value < static_cast<int>(SortKey::Season) || value > static_cast<int>(SortKey::Runtime)) return SortKey::Season;
  return static_cast<SortKey>(value);
}

SortDirection sort_direction_from_int(int value) noexcept {
  return value == static_cast<int>(SortDirection::Desc) ? SortDirection::Desc : SortDirection::Asc;
}

MatchMode match_mode_from_int(int value) noexcept {
  if (value < static_cast<int>(MatchMode::Exact) || value > static_cast<int>(MatchMode::Contains)) return MatchMode::Contains;
  return static_cast<MatchMode>(value);
}

bool field_matches(std::string_view value, std::string_view needle, MatchMode mode) noexcept {
  switch (mode) {
    case MatchMode::Exact: return ascii_iequals(value, needle);
    case MatchMode::Prefix: return ascii_iprefix(value, needle);
    case MatchMode::Contains: return ascii_icontains(value, needle);
  }
  return false;
}

bool composite_matches(std::string_view value, std::string_view needle, MatchMode mode) noexcept {
  if (field_matches(value, needle, mode)) return true;
  if (mode == MatchMode::Contains) return false;

  std::size_t token_start = 0;
  bool escaped = false;
  for (std::size_t i = 0; i <= value.size(); ++i) {
    const bool at_end = i == value.size();
    const char c = at_end ? '\0' : value[i];
    if (!at_end && escaped) {
      escaped = false;
      continue;
    }
    if (!at_end && c == '\\') {
      escaped = true;
      continue;
    }
    const bool pipe = !at_end && c == '|';
    const bool double_colon = !at_end && c == ':' && i + 1 < value.size() && value[i + 1] == ':';
    if (at_end || pipe || double_colon) {
      const std::string_view token = value.substr(token_start, i - token_start);
      if (field_matches(token, needle, mode)) return true;
      if (double_colon) {
        ++i;
        token_start = i + 1;
      } else {
        token_start = i + 1;
      }
    }
  }
  return false;
}

}  // namespace

bool ascii_iequals(std::string_view left, std::string_view right) noexcept {
  if (left.size() != right.size()) return false;
  for (std::size_t i = 0; i < left.size(); ++i) {
    if (ascii_fold(static_cast<unsigned char>(left[i])) != ascii_fold(static_cast<unsigned char>(right[i]))) return false;
  }
  return true;
}

bool ascii_iprefix(std::string_view value, std::string_view prefix) noexcept {
  if (prefix.size() > value.size()) return false;
  return ascii_iequals(value.substr(0, prefix.size()), prefix);
}

bool ascii_icontains(std::string_view value, std::string_view needle) noexcept {
  if (needle.empty()) return true;
  if (needle.size() > value.size()) return false;
  const std::size_t last = value.size() - needle.size();
  for (std::size_t i = 0; i <= last; ++i) {
    if (ascii_iequals(value.substr(i, needle.size()), needle)) return true;
  }
  return false;
}

void Dataset::set_error(std::string message) {
  last_error_ = std::move(message);
}

bool Dataset::reset() {
  headers_.clear();
  header_index_.clear();
  pool_.clear();
  cells_.clear();
  id_to_record_.clear();
  column_count_ = 0;
  finalized_ = false;
  last_error_.clear();
  return true;
}

bool Dataset::add_csv(const std::uint8_t* data, std::size_t size) {
  if (finalized_) {
    set_error("Cannot add CSV after finalize(). Reset the engine first.");
    return false;
  }

  ParsedCsv parsed;
  std::string parse_error;
  if (!parse_csv(data, size, parsed, parse_error)) {
    set_error(std::move(parse_error));
    return false;
  }
  if (!exact_schema(parsed.headers, parse_error)) {
    set_error(std::move(parse_error));
    return false;
  }
  if (!headers_.empty() && parsed.headers != headers_) {
    set_error("CSV header or column order does not match the previously loaded schema.");
    return false;
  }

  const std::uint32_t columns = static_cast<std::uint32_t>(parsed.headers.size());
  const std::size_t id_column = 0;
  std::unordered_set<std::string> incoming_ids;
  incoming_ids.reserve(parsed.rows * 2 + 1);
  for (std::size_t row = 0; row < parsed.rows; ++row) {
    const std::string_view id = field_from(parsed, parsed.cells[row * columns + id_column]);
    if (!valid_internal_id(id)) {
      set_error("Invalid internal id at data row " + std::to_string(row + 1) + ": " + std::string(id));
      return false;
    }
    std::string id_copy(id);
    if (id_to_record_.find(id_copy) != id_to_record_.end() || !incoming_ids.emplace(id_copy).second) {
      set_error("Duplicate internal id detected: " + id_copy);
      return false;
    }
  }

  if (pool_.size() + parsed.pool.size() > std::numeric_limits<std::uint32_t>::max()) {
    set_error("Loaded CSV data exceeds the 32-bit WASM addressable pool limit.");
    return false;
  }

  if (headers_.empty()) {
    headers_ = parsed.headers;
    column_count_ = columns;
    header_index_.reserve(headers_.size() * 2);
    for (std::size_t i = 0; i < headers_.size(); ++i) header_index_.emplace(headers_[i], static_cast<std::uint32_t>(i));
  }

  const std::uint32_t pool_base = static_cast<std::uint32_t>(pool_.size());
  const std::uint32_t record_base = static_cast<std::uint32_t>(record_count());
  pool_.insert(pool_.end(), parsed.pool.begin(), parsed.pool.end());
  cells_.reserve(cells_.size() + parsed.cells.size());
  for (const FieldRef ref : parsed.cells) {
    cells_.push_back(FieldRef{static_cast<std::uint32_t>(pool_base + ref.offset), ref.length});
  }

  for (std::size_t row = 0; row < parsed.rows; ++row) {
    const std::string_view id = field_from(parsed, parsed.cells[row * columns + id_column]);
    id_to_record_.emplace(std::string(id), static_cast<std::uint32_t>(record_base + row));
  }

  last_error_.clear();
  return true;
}

bool Dataset::finalize() {
  if (headers_.empty()) {
    set_error("No CSV has been loaded.");
    return false;
  }
  finalized_ = true;
  last_error_.clear();
  return true;
}

std::size_t Dataset::record_count() const noexcept {
  return column_count_ == 0 ? 0 : cells_.size() / column_count_;
}

std::size_t Dataset::column_count() const noexcept {
  return column_count_;
}

bool Dataset::finalized() const noexcept {
  return finalized_;
}

const std::string& Dataset::last_error() const noexcept {
  return last_error_;
}

std::string_view Dataset::field(std::size_t record_index, std::size_t column_index) const noexcept {
  if (column_count_ == 0 || record_index >= record_count() || column_index >= column_count_) return {};
  const FieldRef& ref = cells_[record_index * column_count_ + column_index];
  if (static_cast<std::size_t>(ref.offset) + ref.length > pool_.size()) return {};
  return {pool_.data() + ref.offset, ref.length};
}

std::string_view Dataset::field(std::size_t record_index, std::string_view column_name) const noexcept {
  const int index = column_index(column_name);
  return index < 0 ? std::string_view{} : field(record_index, static_cast<std::size_t>(index));
}

int Dataset::column_index(std::string_view column_name) const noexcept {
  const auto found = header_index_.find(std::string(column_name));
  return found == header_index_.end() ? -1 : static_cast<int>(found->second);
}

std::vector<std::size_t> Dataset::resolve_group(std::string_view group) const {
  std::vector<std::size_t> result;
  auto add = [&](std::string_view name) {
    const int index = column_index(name);
    if (index >= 0) result.push_back(static_cast<std::size_t>(index));
  };
  auto add_many = [&](std::initializer_list<std::string_view> names) {
    for (const auto name : names) add(name);
  };

  if (group.empty() || group == "all") {
    result.reserve(column_count_);
    for (std::size_t i = 0; i < column_count_; ++i) result.push_back(i);
  } else if (group == "title") {
    add_many({"title_ja", "title_kana", "title_romaji", "title_en", "aliases"});
  } else if (group == "media") {
    add_many({"media_type", "series_id", "season_number"});
  } else if (group == "date") {
    add_many({"release_start", "release_end", "theatrical_release_date", "updated_at"});
  } else if (group == "genre") {
    add_many({"genres", "tags", "target_demographic", "setting", "era", "themes"});
  } else if (group == "original") {
    add_many({"original_type", "original_title", "original_author", "original_artist", "original_publisher",
              "original_label", "original_magazine", "original_platform"});
  } else if (group == "studio") {
    add_many({"animation_studio", "co_animation_studio", "animation_cooperation"});
  } else if (group == "production") {
    add_many({"production_name", "production_committee", "production_members", "production_lead_company", "planning",
              "executive_producers", "producers", "animation_producers", "line_producers"});
  } else if (group == "staff") {
    add_many({"director", "chief_director", "series_composition", "character_original_design", "character_design",
              "music", "sound_director", "staff"});
  } else if (group == "cast") {
    add("characters");
  } else if (group == "music") {
    add_many({"music", "opening_themes", "ending_themes", "insert_songs", "music_production", "soundtrack_label"});
  } else if (group == "broadcast") {
    add_many({"broadcast_networks", "broadcast_slots"});
  } else if (group == "streaming") {
    add("streaming_services");
  } else if (group == "theater") {
    add_many({"film_distributor", "theatrical_release_date"});
  } else if (group == "relations") {
    add_many({"series_id", "relations"});
  } else if (group == "episodes") {
    add_many({"episodes", "episode_staff"});
  } else if (group == "awards") {
    add("awards");
  } else if (group == "synopsis") {
    add("synopsis");
  } else if (group == "official") {
    add_many({"official_url", "official_x", "official_youtube", "official_other"});
  } else if (group == "external") {
    add("external_ids");
  } else {
    const int direct = column_index(group);
    if (direct >= 0) result.push_back(static_cast<std::size_t>(direct));
  }
  return result;
}

std::vector<std::uint32_t> Dataset::all_indices() const {
  std::vector<std::uint32_t> result(record_count());
  for (std::size_t i = 0; i < result.size(); ++i) result[i] = static_cast<std::uint32_t>(i);
  return result;
}

bool Dataset::sort_indices(std::vector<std::uint32_t>& indices, SortKey key, SortDirection direction) const {
  const int release_col = column_index("release_start");
  const int title_kana_col = column_index("title_kana");
  const int title_ja_col = column_index("title_ja");
  const int studio_col = column_index("animation_studio");
  const int episodes_col = column_index("episode_count");
  const int runtime_col = column_index("runtime_min");
  const int id_col = column_index("id");

  auto text_at = [&](std::uint32_t record, int column) -> std::string_view {
    return column < 0 ? std::string_view{} : field(record, static_cast<std::size_t>(column));
  };
  auto title_at = [&](std::uint32_t record) -> std::string_view {
    const std::string_view kana = text_at(record, title_kana_col);
    return trim_ascii(kana).empty() ? text_at(record, title_ja_col) : kana;
  };
  auto runtime_total = [&](std::uint32_t record) -> std::optional<double> {
    const auto runtime = parse_number(text_at(record, runtime_col));
    if (!runtime) return std::nullopt;
    const auto episodes = parse_number(text_at(record, episodes_col));
    if (episodes && *episodes > 0) return (*episodes) * (*runtime);
    return runtime;
  };
  auto stable_tie = [&](std::uint32_t left, std::uint32_t right) {
    int cmp = compare_blank_last(text_at(left, release_col), text_at(right, release_col));
    if (cmp != 0) return cmp;
    cmp = compare_blank_last(title_at(left), title_at(right));
    if (cmp != 0) return cmp;
    return compare_blank_last(text_at(left, id_col), text_at(right, id_col));
  };
  auto directional_text = [&](std::string_view left, std::string_view right) {
    int cmp = compare_blank_last(left, right);
    if (cmp != 0 && direction == SortDirection::Desc && !trim_ascii(left).empty() && !trim_ascii(right).empty()) cmp = -cmp;
    return cmp;
  };

  std::sort(indices.begin(), indices.end(), [&](std::uint32_t left, std::uint32_t right) {
    int cmp = 0;
    switch (key) {
      case SortKey::Season: {
        const int lq = quarter_from_date(text_at(left, release_col));
        const int rq = quarter_from_date(text_at(right, release_col));
        if (lq != rq) {
          if (lq == 5) return false;
          if (rq == 5) return true;
          return direction == SortDirection::Asc ? lq < rq : lq > rq;
        }
        cmp = stable_tie(left, right);
        break;
      }
      case SortKey::Date: cmp = directional_text(text_at(left, release_col), text_at(right, release_col)); break;
      case SortKey::Title: cmp = directional_text(title_at(left), title_at(right)); break;
      case SortKey::Studio: cmp = directional_text(text_at(left, studio_col), text_at(right, studio_col)); break;
      case SortKey::Episodes: {
        const auto a = parse_number(text_at(left, episodes_col));
        const auto b = parse_number(text_at(right, episodes_col));
        if (a.has_value() != b.has_value()) return a.has_value();
        if (a && b && *a != *b) return direction == SortDirection::Asc ? *a < *b : *a > *b;
        cmp = stable_tie(left, right);
        break;
      }
      case SortKey::Runtime: {
        const auto a = runtime_total(left);
        const auto b = runtime_total(right);
        if (a.has_value() != b.has_value()) return a.has_value();
        if (a && b && *a != *b) return direction == SortDirection::Asc ? *a < *b : *a > *b;
        cmp = stable_tie(left, right);
        break;
      }
    }
    if (cmp == 0) cmp = stable_tie(left, right);
    return cmp < 0;
  });
  return true;
}

std::string Dataset::cards_json(const std::vector<std::uint32_t>& indices, std::size_t offset, std::size_t limit) const {
  std::string output;
  output.reserve(std::min<std::size_t>(limit, 100) * 220 + 64);
  output += "{\"items\":[";
  const std::size_t end = std::min(indices.size(), offset + limit);
  bool first = true;
  for (std::size_t i = offset; i < end; ++i) {
    if (!first) output.push_back(',');
    first = false;
    const std::uint32_t record = indices[i];
    const std::string_view id = field(record, "id");
    const std::string_view title = field(record, "title_ja");
    const std::string_view studio = field(record, "animation_studio");
    const std::string_view media = field(record, "media_type");
    const std::string_view image = field(record, "image_url");
    const std::string season = season_label(field(record, "release_start"));

    output += "{\"id\":"; append_json_string(output, id);
    output += ",\"href\":"; append_json_string(output, std::string("../detail/?id=") + std::string(id));
    output += ",\"title\":"; append_json_string(output, title);
    output += ",\"subtitle\":"; append_json_string(output, studio);
    output += ",\"tags\":[";
    bool first_tag = true;
    if (!trim_ascii(media).empty()) { append_json_string(output, media); first_tag = false; }
    if (!season.empty()) { if (!first_tag) output.push_back(','); append_json_string(output, season); }
    output += "],\"imageUrl\":"; append_json_string(output, image);
    output += ",\"imageAlt\":"; append_json_string(output, title);
    output.push_back('}');
  }
  output += "],\"offset\":" + std::to_string(offset);
  output += ",\"count\":" + std::to_string(end > offset ? end - offset : 0);
  output += ",\"total\":" + std::to_string(indices.size());
  output += ",\"hasMore\":";
  output += end < indices.size() ? "true" : "false";
  output.push_back('}');
  return output;
}

std::string Dataset::record_json_by_id(std::string_view id) const {
  const auto found = id_to_record_.find(std::string(id));
  if (found == id_to_record_.end()) return "null";
  const std::uint32_t record = found->second;
  std::string output;
  output.reserve(headers_.size() * 32 + 128);
  output.push_back('{');
  for (std::size_t i = 0; i < headers_.size(); ++i) {
    if (i) output.push_back(',');
    append_json_string(output, headers_[i]);
    output.push_back(':');
    append_json_string(output, field(record, i));
  }
  output.push_back('}');
  return output;
}

int AllEngine::reset() {
  order_.clear(); scratch_.clear(); return dataset_.reset() ? 1 : 0;
}
int AllEngine::add_csv(const std::uint8_t* data, std::size_t size) { return dataset_.add_csv(data, size) ? 1 : 0; }
int AllEngine::finalize() {
  if (!dataset_.finalize()) return 0;
  order_ = dataset_.all_indices();
  return dataset_.sort_indices(order_, SortKey::Season, SortDirection::Asc) ? 1 : 0;
}
int AllEngine::sort(int key, int direction) {
  if (!dataset_.finalized()) return 0;
  return dataset_.sort_indices(order_, sort_key_from_int(key), sort_direction_from_int(direction)) ? 1 : 0;
}
std::size_t AllEngine::count() const noexcept { return order_.size(); }
const char* AllEngine::chunk_json(std::size_t offset, std::size_t limit) {
  scratch_ = dataset_.cards_json(order_, offset, std::min<std::size_t>(limit, 500));
  return scratch_.c_str();
}
const char* AllEngine::last_error() const noexcept { return dataset_.last_error().c_str(); }

int SearchEngine::reset() {
  terms_.clear(); results_.clear(); scratch_.clear(); local_error_.clear(); combine_mode_ = CombineMode::And;
  return dataset_.reset() ? 1 : 0;
}
int SearchEngine::add_csv(const std::uint8_t* data, std::size_t size) { return dataset_.add_csv(data, size) ? 1 : 0; }
int SearchEngine::finalize() { return dataset_.finalize() ? 1 : 0; }
int SearchEngine::clear_terms() { terms_.clear(); results_.clear(); local_error_.clear(); return 1; }
int SearchEngine::set_combine_mode(int mode) {
  if (mode != static_cast<int>(CombineMode::And) && mode != static_cast<int>(CombineMode::Or)) {
    local_error_ = "Invalid combine mode."; return 0;
  }
  combine_mode_ = static_cast<CombineMode>(mode); local_error_.clear(); return 1;
}

int SearchEngine::add_text_term(const char* value, const char* group, int match_mode, int negated) {
  if (!dataset_.finalized()) { local_error_ = "Finalize the dataset before adding search terms."; return 0; }
  if (!value) { local_error_ = "Search term is null."; return 0; }
  const std::string_view trimmed = trim_ascii(value);
  if (trimmed.empty()) { local_error_ = "Search term is empty."; return 0; }
  const std::string_view group_name = group ? std::string_view(group) : std::string_view("all");
  std::vector<std::size_t> columns = dataset_.resolve_group(group_name);
  if (columns.empty()) { local_error_ = "Search group has no columns: " + std::string(group_name); return 0; }
  Term term;
  term.kind = TermKind::Text;
  term.value.assign(trimmed);
  term.columns = std::move(columns);
  term.match_mode = match_mode_from_int(match_mode);
  term.negated = negated != 0;
  terms_.push_back(std::move(term));
  local_error_.clear();
  return 1;
}

int SearchEngine::add_number_range(const char* column, const char* minimum, const char* maximum, int negated) {
  if (!dataset_.finalized()) { local_error_ = "Finalize the dataset before adding search terms."; return 0; }
  if (!column || !*column) { local_error_ = "Number range column is empty."; return 0; }
  const int index = dataset_.column_index(column);
  if (index < 0) { local_error_ = "Number range column does not exist: " + std::string(column); return 0; }
  const std::string min_value = minimum ? std::string(trim_ascii(minimum)) : std::string();
  const std::string max_value = maximum ? std::string(trim_ascii(maximum)) : std::string();
  if (min_value.empty() && max_value.empty()) { local_error_ = "Number range requires a minimum or maximum."; return 0; }
  const auto min_number = min_value.empty() ? std::optional<double>{} : parse_number(min_value);
  const auto max_number = max_value.empty() ? std::optional<double>{} : parse_number(max_value);
  if ((!min_value.empty() && !min_number) || (!max_value.empty() && !max_number)) { local_error_ = "Number range boundary is invalid."; return 0; }
  if (min_number && max_number && *min_number > *max_number) { local_error_ = "Number range minimum exceeds maximum."; return 0; }
  Term term;
  term.kind = TermKind::NumberRange; term.minimum = min_value; term.maximum = max_value;
  term.columns = {static_cast<std::size_t>(index)}; term.negated = negated != 0;
  terms_.push_back(std::move(term)); local_error_.clear(); return 1;
}

int SearchEngine::add_date_range(const char* column, const char* minimum, const char* maximum, int negated) {
  if (!dataset_.finalized()) { local_error_ = "Finalize the dataset before adding search terms."; return 0; }
  if (!column || !*column) { local_error_ = "Date range column is empty."; return 0; }
  const int index = dataset_.column_index(column);
  if (index < 0) { local_error_ = "Date range column does not exist: " + std::string(column); return 0; }
  const std::string min_value = minimum ? std::string(trim_ascii(minimum)) : std::string();
  const std::string max_value = maximum ? std::string(trim_ascii(maximum)) : std::string();
  if (min_value.empty() && max_value.empty()) { local_error_ = "Date range requires a minimum or maximum."; return 0; }
  if (!valid_date_precision(min_value) || !valid_date_precision(max_value)) { local_error_ = "Date range boundary is invalid."; return 0; }
  if (!min_value.empty() && !max_value.empty() && normalize_date(min_value, false) > normalize_date(max_value, true)) {
    local_error_ = "Date range minimum exceeds maximum."; return 0;
  }
  Term term;
  term.kind = TermKind::DateRange; term.minimum = min_value; term.maximum = max_value;
  term.columns = {static_cast<std::size_t>(index)}; term.negated = negated != 0;
  terms_.push_back(std::move(term)); local_error_.clear(); return 1;
}

bool SearchEngine::matches_term(std::size_t record_index, const Term& term) const {
  bool matched = false;
  if (term.kind == TermKind::Text) {
    for (const std::size_t column : term.columns) {
      if (composite_matches(dataset_.field(record_index, column), term.value, term.match_mode)) { matched = true; break; }
    }
  } else if (term.kind == TermKind::NumberRange) {
    matched = number_in_range(dataset_.field(record_index, term.columns.front()), term.minimum, term.maximum);
  } else {
    matched = date_in_range(dataset_.field(record_index, term.columns.front()), term.minimum, term.maximum);
  }
  return term.negated ? !matched : matched;
}

int SearchEngine::execute() {
  if (!dataset_.finalized()) { local_error_ = "Finalize the dataset before executing a search."; return 0; }
  if (terms_.empty()) { local_error_ = "At least one search term is required."; return 0; }
  results_.clear();
  results_.reserve(dataset_.record_count() / 4 + 16);
  for (std::size_t record = 0; record < dataset_.record_count(); ++record) {
    bool accepted = combine_mode_ == CombineMode::And;
    if (combine_mode_ == CombineMode::And) {
      for (const Term& term : terms_) if (!matches_term(record, term)) { accepted = false; break; }
    } else {
      accepted = false;
      for (const Term& term : terms_) if (matches_term(record, term)) { accepted = true; break; }
    }
    if (accepted) results_.push_back(static_cast<std::uint32_t>(record));
  }
  dataset_.sort_indices(results_, SortKey::Season, SortDirection::Asc);
  local_error_.clear();
  return 1;
}

int SearchEngine::sort(int key, int direction) {
  return dataset_.sort_indices(results_, sort_key_from_int(key), sort_direction_from_int(direction)) ? 1 : 0;
}
std::size_t SearchEngine::count() const noexcept { return results_.size(); }
const char* SearchEngine::chunk_json(std::size_t offset, std::size_t limit) {
  scratch_ = dataset_.cards_json(results_, offset, std::min<std::size_t>(limit, 500));
  return scratch_.c_str();
}
const char* SearchEngine::record_json_by_id(const char* id) {
  scratch_ = id ? dataset_.record_json_by_id(id) : "null";
  return scratch_.c_str();
}
const char* SearchEngine::last_error() const noexcept {
  return local_error_.empty() ? dataset_.last_error().c_str() : local_error_.c_str();
}

}  // namespace anime
