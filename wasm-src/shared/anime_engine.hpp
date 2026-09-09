#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace anime {

enum class SortKey : int {
  Season = 0,
  Date = 1,
  Title = 2,
  Studio = 3,
  Episodes = 4,
  Runtime = 5,
};

enum class SortDirection : int {
  Asc = 0,
  Desc = 1,
};

enum class MatchMode : int {
  Exact = 0,
  Prefix = 1,
  Contains = 2,
};

enum class CombineMode : int {
  And = 0,
  Or = 1,
};

struct FieldRef {
  std::uint32_t offset = 0;
  std::uint32_t length = 0;
};

class Dataset {
 public:
  bool reset();
  bool add_csv(const std::uint8_t* data, std::size_t size);
  bool finalize();

  std::size_t record_count() const noexcept;
  std::size_t column_count() const noexcept;
  bool finalized() const noexcept;
  const std::string& last_error() const noexcept;

  std::string_view field(std::size_t record_index, std::size_t column_index) const noexcept;
  std::string_view field(std::size_t record_index, std::string_view column_name) const noexcept;
  int column_index(std::string_view column_name) const noexcept;
  std::vector<std::size_t> resolve_group(std::string_view group) const;

  std::vector<std::uint32_t> all_indices() const;
  bool sort_indices(std::vector<std::uint32_t>& indices, SortKey key, SortDirection direction) const;

  std::string cards_json(const std::vector<std::uint32_t>& indices,
                         std::size_t offset,
                         std::size_t limit) const;
  std::string record_json_by_id(std::string_view id) const;

 private:
  std::vector<std::string> headers_;
  std::unordered_map<std::string, std::uint32_t> header_index_;
  std::vector<char> pool_;
  std::vector<FieldRef> cells_;
  std::unordered_map<std::string, std::uint32_t> id_to_record_;
  std::uint32_t column_count_ = 0;
  bool finalized_ = false;
  std::string last_error_;

  void set_error(std::string message);
};

class AllEngine {
 public:
  int reset();
  int add_csv(const std::uint8_t* data, std::size_t size);
  int finalize();
  int sort(int key, int direction);
  std::size_t count() const noexcept;
  const char* chunk_json(std::size_t offset, std::size_t limit);
  const char* last_error() const noexcept;

 private:
  Dataset dataset_;
  std::vector<std::uint32_t> order_;
  std::string scratch_;
};

class SearchEngine {
 public:
  int reset();
  int add_csv(const std::uint8_t* data, std::size_t size);
  int finalize();

  int clear_terms();
  int set_combine_mode(int mode);
  int add_text_term(const char* value, const char* group, int match_mode, int negated);
  int add_number_range(const char* column, const char* minimum, const char* maximum, int negated);
  int add_date_range(const char* column, const char* minimum, const char* maximum, int negated);
  int execute();
  int sort(int key, int direction);

  std::size_t count() const noexcept;
  const char* chunk_json(std::size_t offset, std::size_t limit);
  const char* record_json_by_id(const char* id);
  const char* last_error() const noexcept;

 private:
  enum class TermKind { Text, NumberRange, DateRange };

  struct Term {
    TermKind kind = TermKind::Text;
    std::string value;
    std::string minimum;
    std::string maximum;
    std::vector<std::size_t> columns;
    MatchMode match_mode = MatchMode::Contains;
    bool negated = false;
  };

  bool matches_term(std::size_t record_index, const Term& term) const;

  Dataset dataset_;
  CombineMode combine_mode_ = CombineMode::And;
  std::vector<Term> terms_;
  std::vector<std::uint32_t> results_;
  std::string scratch_;
  std::string local_error_;
};

bool ascii_iequals(std::string_view left, std::string_view right) noexcept;
bool ascii_iprefix(std::string_view value, std::string_view prefix) noexcept;
bool ascii_icontains(std::string_view value, std::string_view needle) noexcept;

}  // namespace anime
