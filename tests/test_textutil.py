"""
Text clean-up applied to everything the bot says or hears.

These are small pure functions, but they run on every message - a regex that is
slightly too greedy silently eats real content (a word before a colon, the last
italic phrase, a whole reply). The cases here are the ones that must survive.
"""
from src.utils.textutil import (
    clean_links,
    clean_text,
    clean_user_message,
    remove_fluff,
    remove_last_word_before_final_colon,
    remove_string_before_final,
)


class TestCleanUserMessage:
    def test_strips_the_bot_mention_and_the_surrounding_whitespace(self):
        assert clean_user_message("  @Kobold ahoj  ") == "ahoj"

    def test_removes_the_endoftext_marker_a_model_can_leak(self):
        assert clean_user_message("ahoj<|endoftext|>") == "ahoj"

    def test_keeps_a_message_that_needs_no_cleaning(self):
        assert clean_user_message("ako sa máš?") == "ako sa máš?"

    def test_keeps_other_mentions_intact(self):
        assert clean_user_message("@Monika pozri na to") == "@Monika pozri na to"


class TestCleanText:
    def test_drops_a_trailing_emoji(self):
        assert clean_text("ahoj 😀") == "ahoj"

    def test_keeps_an_emoji_in_the_middle_of_a_sentence(self):
        assert clean_text("ahoj 😀 ako sa máš?") == "ahoj  ako sa máš?"

    def test_removes_trailing_line_breaks(self):
        assert clean_text("odpoveď\n\n") == "odpoveď"

    def test_removes_a_dangling_bracket_or_colon_left_by_a_cut_off_model(self):
        assert clean_text("odpoveď)") == "odpoveď"
        assert clean_text("odpoveď:") == "odpoveď"
        assert clean_text("odpoveď,") == "odpoveď"

    def test_keeps_sentence_punctuation_that_belongs_there(self):
        assert clean_text("naozaj?") == "naozaj?"
        assert clean_text("hotovo!") == "hotovo!"

    def test_leaves_an_empty_string_empty(self):
        assert clean_text("") == ""


class TestRemoveLastWordBeforeFinalColon:
    def test_drops_a_trailing_speaker_label(self):
        assert remove_last_word_before_final_colon("Ahoj, ako sa máš? Zahul:") == "Ahoj, ako sa máš?"

    def test_leaves_a_colon_in_the_middle_of_the_text(self):
        assert remove_last_word_before_final_colon("Zahul: ahoj") == "Zahul: ahoj"

    def test_leaves_text_without_a_trailing_colon_untouched(self):
        assert remove_last_word_before_final_colon("obyčajná veta") == "obyčajná veta"


class TestRemoveStringBeforeFinal:
    def test_strips_a_trailing_system_marker(self):
        assert remove_string_before_final("odpoveď [System") == "odpoveď "
        assert remove_string_before_final("odpoveď [End]") == "odpoveď "

    def test_keeps_a_marker_that_is_not_at_the_end(self):
        assert remove_string_before_final("[System] a potom odpoveď") == "[System] a potom odpoveď"

    def test_keeps_ordinary_text(self):
        assert remove_string_before_final("normálna odpoveď") == "normálna odpoveď"


class TestRemoveFluff:
    def test_removes_the_last_asterisked_action(self):
        assert remove_fluff("Ahoj *usmeje sa*") == "Ahoj"

    def test_removes_only_the_last_one(self):
        assert remove_fluff("*kýve* ahoj *usmeje sa*") == "*kýve* ahoj"

    def test_leaves_text_without_asterisks_alone(self):
        assert remove_fluff("iba text") == "iba text"


class TestCleanLinks:
    def test_strips_tracking_parameters(self):
        cleaned = clean_links("pozri https://example.com/article?utm_source=discord&utm_medium=bot")
        assert "utm_source" not in cleaned
        assert "example.com/article" in cleaned

    def test_keeps_parameters_the_page_actually_needs(self):
        cleaned = clean_links("https://example.com/search?q=pixel+art")
        assert "q=pixel+art" in cleaned

    def test_leaves_a_message_without_links_unchanged(self):
        assert clean_links("žiadny odkaz tu nie je") == "žiadny odkaz tu nie je"
