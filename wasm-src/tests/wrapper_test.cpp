#include "../shared/schema.hpp"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <string>
#include <string_view>
#include <unordered_map>

extern "C" {
int anime_all_reset();
int anime_all_add_csv(const std::uint8_t* data, std::size_t size);
int anime_all_finalize();
int anime_all_sort(int key, int direction);
std::size_t anime_all_count();
const char* anime_all_chunk_json(std::size_t offset, std::size_t limit);
const char* anime_all_last_error();

int anime_search_reset();
int anime_search_add_csv(const std::uint8_t* data, std::size_t size);
int anime_search_finalize();
int anime_search_clear_terms();
int anime_search_set_combine_mode(int mode);
int anime_search_add_text_term(const char* value, const char* selector, int match_mode, int negated);
int anime_search_add_number_range(const char* column, const char* minimum, const char* maximum, int negated);
int anime_search_add_date_range(const char* selector, const char* minimum, const char* maximum, int negated);
int anime_search_execute();
int anime_search_sort(int key, int direction);
std::size_t anime_search_count();
const char* anime_search_chunk_json(std::size_t offset, std::size_t limit);
const char* anime_search_record_json_by_id(const char* id);
const char* anime_search_last_error();
}

namespace {

std::string csv_escape(std::string_view value) {
  bool quote = false;
  for (const char c : value) {
    if (c == ',' || c == '"' || c == '\r' || c == '\n') {
      quote = true;
      break;
    }
  }
  if (!quote) return std::string(value);
  std::string out = "\"";
  for (const char c : value) {
    if (c == '"') out += "\"\"";
    else out.push_back(c);
  }
  out.push_back('"');
  return out;
}

void append_row(std::string& csv, const std::unordered_map<std::string, std::string>& values) {
  for (std::size_t i = 0; i < anime::schema::kColumns.size(); ++i) {
    if (i) csv.push_back(',');
    const auto found = values.find(std::string(anime::schema::kColumns[i]));
    if (found != values.end()) csv += csv_escape(found->second);
  }
  csv.push_back('\n');
}

std::string make_csv() {
  std::string csv;
  for (std::size_t i = 0; i < anime::schema::kColumns.size(); ++i) {
    if (i) csv.push_back(',');
    csv += anime::schema::kColumns[i];
  }
  csv.push_back('\n');

  append_row(csv, {
      {"id", "A00000001"},
      {"title_ja", "春の作品"},
      {"title_kana", "はるのさくひん"},
      {"media_type", "TV"},
      {"release_start", "2027-04"},
      {"episode_count", "12"},
      {"runtime_min", "24"},
      {"tags", "共通"},
      {"animation_studio", "Studio A"},
      {"production_committee", "春委員会"},
      {"characters", "主人公::MAIN::声優A"},
      {"opening_themes", "OP::春の歌::歌手A::作詞A::作曲A::編曲A"},
      {"streaming_services", "Service A::通常::日本::2027-04-05::"},
      {"episodes", "1::第一話::2027-04-05"},
      {"awards", "2027::賞A::受賞"},
      {"updated_at", "2027-04-06"},
  });

  append_row(csv, {
      {"id", "A00000002"},
      {"title_ja", "秋の作品"},
      {"title_kana", "あきのさくひん"},
      {"media_type", "MOVIE"},
      {"release_start", "2027-10-01"},
      {"runtime_min", "110"},
      {"tags", "共通"},
      {"animation_studio", "Studio B"},
      {"production_committee", "秋委員会"},
      {"characters", "主人公::MAIN::声優B"},
      {"opening_themes", "OP::秋の歌::歌手B::作詞B::作曲B::編曲B"},
      {"streaming_services", "Service B::独占::日本::2027-10-01::2028-01-01"},
      {"episodes", "1::本編::2027-10-01"},
      {"awards", "2028::賞B::受賞"},
      {"updated_at", "2027-10-02"},
  });
  return csv;
}

void add_all_csv(const std::string& csv) {
  assert(anime_all_add_csv(reinterpret_cast<const std::uint8_t*>(csv.data()), csv.size()) == 1);
}

void add_search_csv(const std::string& csv) {
  assert(anime_search_add_csv(reinterpret_cast<const std::uint8_t*>(csv.data()), csv.size()) == 1);
}

}  // namespace

int main() {
  const std::string csv = make_csv();

  assert(anime_all_reset() == 1);
  add_all_csv(csv);
  assert(anime_all_finalize() == 1);
  assert(anime_all_count() == 2);
  assert(anime_all_sort(5, 1) == 1);
  assert(std::string(anime_all_chunk_json(0, 100)).find("A00000002") != std::string::npos);

  assert(anime_search_reset() == 1);
  add_search_csv(csv);
  assert(anime_search_finalize() == 1);

  assert(anime_search_add_text_term("春委員会", "production_committee", 2, 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 1);
  assert(std::string(anime_search_chunk_json(0, 100)).find("A00000001") != std::string::npos);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_add_text_term("声優B", "characters", 0, 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 1);
  assert(std::string(anime_search_chunk_json(0, 100)).find("A00000002") != std::string::npos);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_add_text_term("Studio A", "animation_studio", 2, 1) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 1);
  assert(std::string(anime_search_chunk_json(0, 100)).find("A00000002") != std::string::npos);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_set_combine_mode(1) == 1);
  assert(anime_search_add_text_term("春", "title_ja", 2, 0) == 1);
  assert(anime_search_add_text_term("秋", "title_ja", 2, 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 2);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_set_combine_mode(0) == 1);
  assert(anime_search_add_number_range("runtime_min", "100", "120", 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 1);
  assert(std::string(anime_search_record_json_by_id("A00000002")).find("秋の作品") != std::string::npos);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_add_number_range("runtime_min", "120", "100", 0) == 0);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_add_date_range("release_start", "2027-04-01", "2027-04-30", 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 1);
  assert(std::string(anime_search_chunk_json(0, 100)).find("A00000001") != std::string::npos);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_add_date_range("release_start", "2027-04", "2027-04", 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 1);
  assert(std::string(anime_search_chunk_json(0, 100)).find("A00000001") != std::string::npos);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_add_date_range("release_start", "2027-12", "2027-01", 0) == 0);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_add_date_range("streaming_start", "2027-09-01", "2027-12-31", 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 1);
  assert(std::string(anime_search_chunk_json(0, 100)).find("A00000002") != std::string::npos);

  assert(anime_search_clear_terms() == 1);
  assert(anime_search_add_date_range("episode_air_date", "2027-04-01", "2027-04-30", 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == 1);
  assert(std::string(anime_search_chunk_json(0, 100)).find("A00000001") != std::string::npos);

  // 共通6ソートは同じ入力ならsearch/allで必ず同じ順序を返す。
  assert(anime_search_clear_terms() == 1);
  assert(anime_search_set_combine_mode(0) == 1);
  assert(anime_search_add_text_term("共通", "tags", 0, 0) == 1);
  assert(anime_search_execute() == 1);
  assert(anime_search_count() == anime_all_count());
  for (int key = 0; key < 6; ++key) {
    for (int direction = 0; direction < 2; ++direction) {
      assert(anime_all_sort(key, direction) == 1);
      assert(anime_search_sort(key, direction) == 1);
      assert(std::string(anime_all_chunk_json(0, 100)) ==
             std::string(anime_search_chunk_json(0, 100)));
    }
  }

  assert(anime_all_reset() == 1);
  const std::string invalid = "id,title_ja\nA00000001,invalid\n";
  assert(anime_all_add_csv(reinterpret_cast<const std::uint8_t*>(invalid.data()), invalid.size()) == 0);
  assert(std::string(anime_all_last_error()).find("schema") != std::string::npos ||
         std::string(anime_all_last_error()).find("Schema") != std::string::npos);

  std::cout << "wrapper_test: PASS\n";
  return 0;
}
