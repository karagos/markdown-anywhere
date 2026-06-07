from server.tokens import count_tokens


def test_empty_is_zero():
    assert count_tokens("") == 0
    assert count_tokens(None) == 0


def test_counts_are_positive_and_reasonable():
    # "hello world" is 2 tokens with tiktoken, ~3 with the fallback — accept a small range.
    assert 1 <= count_tokens("hello world") <= 5
    long_text = "word " * 200
    n = count_tokens(long_text)
    assert n > 100  # clearly scales with content


def test_handles_special_token_strings():
    # Must not raise on text containing tiktoken special-token markers.
    assert count_tokens("<|endoftext|> hello") >= 1
