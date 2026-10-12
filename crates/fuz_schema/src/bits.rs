//! A fixed-size set of small integers, for which entries of an object schema
//! have been seen and which must be.

const WORD: usize = u64::BITS as usize;

/// A set of the integers below a length fixed when it is made. Sets of up to
/// 64 hold no allocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Bits {
    Small(u64),
    Large(Box<[u64]>),
}

impl Default for Bits {
    fn default() -> Self {
        Self::Small(0)
    }
}

impl Bits {
    /// An empty set of the integers below `len`.
    pub(crate) fn new(len: usize) -> Self {
        if len <= WORD {
            Self::Small(0)
        } else {
            Self::Large(vec![0; len.div_ceil(WORD)].into_boxed_slice())
        }
    }

    /// Adds `index`, which must be below the length the set was made with.
    pub(crate) fn insert(&mut self, index: usize) {
        match self {
            Self::Small(word) => *word |= 1 << index,
            Self::Large(words) => words[index / WORD] |= 1 << (index % WORD),
        }
    }

    #[cfg(test)]
    pub(crate) fn contains(&self, index: usize) -> bool {
        match self {
            Self::Small(word) => word & (1 << index) != 0,
            Self::Large(words) => words[index / WORD] & (1 << (index % WORD)) != 0,
        }
    }

    /// Whether every member of `other` is a member of this set. The two must
    /// have been made with the same length.
    pub(crate) fn is_superset(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Small(word), Self::Small(other)) => word & other == *other,
            (Self::Large(words), Self::Large(other)) => words
                .iter()
                .zip(other)
                .all(|(word, other)| word & other == *other),
            // made with different lengths, which the callers never do
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_and_large_sets_agree() {
        for len in [0, 1, 64, 65, 200] {
            let mut bits = Bits::new(len);
            let mut required = Bits::new(len);
            assert_eq!(matches!(bits, Bits::Small(_)), len <= 64, "{len}");
            assert!(bits.is_superset(&required));
            for index in (0..len).step_by(3) {
                required.insert(index);
            }
            if len > 0 {
                assert!(!bits.is_superset(&required));
                assert!(required.contains(0));
            }
            for index in 0..len {
                assert!(!bits.contains(index));
                bits.insert(index);
                assert!(bits.contains(index));
            }
            assert!(bits.is_superset(&required));
            if len > 1 {
                assert!(!required.is_superset(&bits));
                assert!(!required.contains(1));
            }
        }
    }

    #[test]
    fn sets_of_different_lengths_are_not_supersets() {
        assert!(!Bits::new(1).is_superset(&Bits::new(100)));
        assert!(!Bits::new(100).is_superset(&Bits::new(1)));
    }
}
