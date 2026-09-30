pub struct SafetyGovernor {
    pub max_tool_depth: u32,
    pub active_calls: u32,
}

impl SafetyGovernor {
    pub fn new(max_depth: u32) -> Self {
        SafetyGovernor {
            max_tool_depth: max_depth,
            active_calls: 0,
        }
    }

    pub fn authorize_call(&mut self, _tool_name: &str) -> bool {
        if self.active_calls >= self.max_tool_depth {
            return false;
        }
        self.active_calls += 1;
        true
    }

    pub fn release_call(&mut self) {
        if self.active_calls > 0 {
            self.active_calls -= 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SafetyGovernor;

    #[test]
    fn enforces_depth_and_recovers_capacity_after_release() {
        let mut governor = SafetyGovernor::new(2);

        assert!(governor.authorize_call("view_file"));
        assert!(governor.authorize_call("run_command"));
        assert!(!governor.authorize_call("overflow"));

        governor.release_call();

        assert!(governor.authorize_call("replacement"));
        assert_eq!(governor.active_calls, 2);
    }

    #[test]
    fn release_is_saturating() {
        let mut governor = SafetyGovernor::new(1);

        governor.release_call();

        assert_eq!(governor.active_calls, 0);
    }
}
