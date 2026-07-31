module Main where

import ASTValidator (ASTNode (..), validateAST)

assert :: String -> Bool -> IO ()
assert label condition =
  if condition
    then pure ()
    else error ("assertion failed: " ++ label)

main :: IO ()
main = do
  assert
    "nested safe actions validate"
    (validateAST (FunctionNode "workflow" [ActionNode "READ", ActionNode "WRITE_DRAFT"]))
  assert
    "dangerous delete is rejected"
    (not (validateAST (ActionNode "DANGEROUS_DELETE")))
  assert
    "error nodes fail closed"
    (not (validateAST (ErrorNode "invalid")))
  putStrLn "3 Haskell AST invariants passed"
