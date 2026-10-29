from app.utils.text_cleaner import (
    clean_resume_text,
    normalize_line_endings,
    normalize_text,
    normalize_unicode,
    normalize_whitespace,
    remove_excessive_blank_lines,
)


def test_normal_resume_text_is_preserved():
    text = (
        "Education\n\n"
        "Bachelor of Engineering\n"
        "XYZ University\n\n"
        "Skills\n\n"
        "Python\n"
        "React\n"
        "Node.js"
    )
    assert clean_resume_text(text) == text


def test_windows_and_old_mac_line_endings_are_normalized():
    assert normalize_line_endings("a\r\nb\rc\nd") == "a\nb\nc\nd"


def test_page_breaks_and_unicode_separators_become_newlines():
    assert normalize_line_endings("page1\x0cpage2 line") == "page1\npage2\nline"


def test_extra_whitespace_is_collapsed_per_line():
    assert normalize_whitespace("John   Doe\t\tEngineer   \n   Python  ") == "John Doe Engineer\nPython"


def test_non_breaking_and_wide_spaces_are_collapsed():
    assert normalize_whitespace("John  Doe Engineer") == "John Doe Engineer"


def test_whitespace_only_lines_become_empty():
    assert normalize_whitespace("a\n   \t \nb") == "a\n\nb"


def test_multiple_blank_lines_are_reduced_to_one():
    assert remove_excessive_blank_lines("a\n\n\n\n\nb\n\nc\nd") == "a\n\nb\n\nc\nd"


def test_ligatures_are_expanded():
    assert normalize_unicode("ﬁnance oﬃce") == "finance office"


def test_invisible_and_control_characters_are_removed():
    assert normalize_unicode("Py​thon­ \x00Dev﻿\x07") == "Python Dev"


def test_meaningful_unicode_is_preserved():
    text = "José Müller — C++ • Résumé ™ ½ 日本語 😀"
    assert normalize_unicode(text) == text


def test_decomposed_unicode_is_composed():
    decomposed = "José"  # e + combining acute accent
    assert normalize_text(decomposed) == "José"


def test_full_pipeline_on_messy_text():
    raw = "﻿  John  Doe \r\n\r\n\r\n\r\nSoftware Engineer\t\r\n   \r\n\r\nSkills:\x0cPython  \n\n"
    assert clean_resume_text(raw) == "John Doe\n\nSoftware Engineer\n\nSkills:\nPython"


def test_clean_resume_text_of_whitespace_only_is_empty():
    assert clean_resume_text(" \n\t\r\n ​ ") == ""
