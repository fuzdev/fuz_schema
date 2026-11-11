//! The format tests, `uuid` and `iso_datetime`, as scans of a string's bytes.
//!
//! Each is the grammar `docs/formats.md` gives, as the TypeScript library
//! tests it: `uuid` by the string's length and char codes, with a regular
//! expression for the nil and max UUIDs, and `iso_datetime` by a regular
//! expression. Here both are scans by hand: exact lengths, ASCII
//! digits and hex digits only, and nothing past the end, so a trailing
//! newline fails as it fails the library's length check and its `$` without
//! the `m` flag.

/// Whether `text` is a UUID of RFC 9562: 8-4-4-4-12 hex digits of either case,
/// with a version from 1 to 8 and the RFC's variant, or the nil UUID, or the
/// max UUID in either case.
pub fn is_uuid(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (index, &byte) in bytes.iter().enumerate() {
        let fits = if matches!(index, 8 | 13 | 18 | 23) {
            byte == b'-'
        } else {
            byte.is_ascii_hexdigit()
        };
        if !fits {
            return false;
        }
    }
    let version = bytes[14];
    let variant = bytes[19];
    (matches!(version, b'1'..=b'8') && matches!(variant, b'8' | b'9' | b'a' | b'b' | b'A' | b'B'))
        || text == "00000000-0000-0000-0000-000000000000"
        || text.eq_ignore_ascii_case("ffffffff-ffff-ffff-ffff-ffffffffffff")
}

/// Whether `text` is a date and time of RFC 3339 in UTC, as
/// `2024-02-29T23:59:59.123Z`: a date of the Gregorian calendar with a year of
/// exactly four digits, `0000` a leap year, an uppercase `T`, hours, minutes,
/// and seconds of two digits each with no leap second, a fraction of 1 to 9
/// digits or none, and an uppercase `Z`.
pub fn is_iso_datetime(text: &str) -> bool {
    let bytes = text.as_bytes();
    // `YYYY-MM-DDTHH:MM:SS`, then the fraction and the `Z`
    if bytes.len() < 20 {
        return false;
    }
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        digits(&bytes[0..4]),
        digits(&bytes[5..7]),
        digits(&bytes[8..10]),
        digits(&bytes[11..13]),
        digits(&bytes[14..16]),
        digits(&bytes[17..19]),
    ) else {
        return false;
    };
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return false;
    }
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return false;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    match &bytes[19..] {
        [b'Z'] => true,
        [b'.', fraction @ .., b'Z'] => {
            (1..=9).contains(&fraction.len()) && fraction.iter().all(u8::is_ascii_digit)
        }
        _ => false,
    }
}

/// The number the ASCII digits spell, when they are all digits.
fn digits(bytes: &[u8]) -> Option<u32> {
    bytes.iter().try_fold(0, |number, &byte| {
        byte.is_ascii_digit()
            .then(|| number * 10 + u32::from(byte - b'0'))
    })
}

/// The days of `month`, from 1 to 12, of `year` in the Gregorian calendar.
const fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuids() {
        for text in [
            "123e4567-e89b-12d3-a456-426614174000",
            "123E4567-E89B-42D3-A456-426614174000",
            "00000000-0000-8000-bfff-000000000000",
            "00000000-0000-0000-0000-000000000000",
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
            "ffffffff-FFFF-ffff-FFFF-ffffffffffff",
        ] {
            assert!(is_uuid(text), "{text}");
        }
        for text in [
            "",
            "123e4567-e89b-02d3-a456-426614174000",
            "123e4567-e89b-92d3-a456-426614174000",
            "123e4567-e89b-f2d3-a456-426614174000",
            "123e4567-e89b-12d3-7456-426614174000",
            "123e4567-e89b-12d3-c456-426614174000",
            "123e4567-e89b-12d3-0456-426614174000",
            "{123e4567-e89b-12d3-a456-426614174000}",
            "123e4567e89b12d3a456426614174000",
            "123e4567-e89b-12d3-a456-426614174000\n",
            "123e4567-e89b-12d3-a456-42661417400",
            "123e4567-e89b-12d3-a456-4266141740000",
            "123e4567_e89b-12d3-a456-426614174000",
            "123e4567-e89b-12d3-a456-42661417400\u{ff10}",
            "g23e4567-e89b-12d3-a456-426614174000",
            // the nil UUID has no case, and one digit off either is neither
            "00000000-0000-0000-0000-000000000001",
            "ffffffff-ffff-ffff-ffff-fffffffffffe",
        ] {
            assert!(!is_uuid(text), "{text}");
        }
    }

    #[test]
    fn datetimes() {
        for text in [
            "2024-01-01T00:00:00Z",
            "2024-01-01T00:00:00.1Z",
            "2024-01-01T23:59:59.123456789Z",
            "2024-02-29T00:00:00Z",
            "2000-02-29T00:00:00Z",
            "0000-02-29T00:00:00Z",
            "0000-01-01T00:00:00Z",
            "9999-12-31T23:59:59Z",
            "2024-04-30T00:00:00Z",
        ] {
            assert!(is_iso_datetime(text), "{text}");
        }
        for text in [
            "",
            "2024-01-01T00:00:00",
            "2024-01-01T00:00:00.1234567890Z",
            "2024-01-01T00:00:00.Z",
            "2024-01-01T00:00:00,5Z",
            "2024-01-01T00:00:00+01:00",
            "2024-01-01T00:00:00-00:00",
            "2024-01-01T00:00:00+0100",
            "2024-01-01T00:00Z",
            "2024-01-01t00:00:00Z",
            "2024-01-01T00:00:00z",
            "2024-01-01 00:00:00Z",
            "2024-02-30T00:00:00Z",
            "2023-02-29T00:00:00Z",
            "1900-02-29T00:00:00Z",
            "2024-04-31T00:00:00Z",
            "2024-13-01T00:00:00Z",
            "2024-00-01T00:00:00Z",
            "2024-01-00T00:00:00Z",
            "2024-01-01T24:00:00Z",
            "2024-01-01T23:60:00Z",
            "2024-01-01T23:59:60Z",
            "+002024-01-01T00:00:00Z",
            "2024-01-01T00:00:00Z\n",
            "\u{ff12}024-01-01T00:00:00Z",
            "2024-01-01T00:00:00.\u{ff11}Z",
            "2024-1-01T00:00:00Z",
        ] {
            assert!(!is_iso_datetime(text), "{text}");
        }
    }

    #[test]
    fn leap_years_are_gregorian() {
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2023, 2), 28);
        assert_eq!(days_in_month(1900, 2), 28);
        assert_eq!(days_in_month(2000, 2), 29);
        assert_eq!(days_in_month(0, 2), 29);
    }
}
