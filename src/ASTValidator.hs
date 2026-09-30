module ASTValidator (validateAST, ASTNode(..)) where

data ASTNode = FunctionNode String [ASTNode]
             | ActionNode String
             | ErrorNode String
             deriving (Show, Eq)

validateAST :: ASTNode -> Bool
validateAST (FunctionNode _ children) = all validateAST children
validateAST (ActionNode name)        = name /= "DANGEROUS_DELETE"
validateAST (ErrorNode _)            = False
