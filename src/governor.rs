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

    pub fn authorize_call(&mut self, tool_name: &str) -> bool {
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
