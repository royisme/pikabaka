export interface Solution {
  problem_identifier_script: string; // What to say to confirm understanding
  brainstorm_script: string;         // What to say to compare approaches
  code: string;                      // The actual code block
  dry_run_script: string;            // What to say to trace the code
  time_complexity: string;
  space_complexity: string;
}

export interface SolutionsResponse {
  [key: string]: Solution
}

export interface ProblemStatementData {
  problem_statement: string;
  input_format: {
    description: string;
    parameters: any[];
  };
  output_format: {
    description: string;
    type: string;
    subtype: string;
  };
  complexity: {
    time: string;
    space: string;
  };
  test_cases: any[];
  validation_type: string;
  difficulty: string;
}