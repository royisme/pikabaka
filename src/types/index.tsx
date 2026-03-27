export interface Screenshot {
  id: string
  path: string
  timestamp: number
  thumbnail: string // Base64 thumbnail
}

export interface Solution {
  problem_identifier_script: string;
  brainstorm_script: string;
  code: string;
  dry_run_script: string;
  time_complexity: string;
  space_complexity: string;
}
